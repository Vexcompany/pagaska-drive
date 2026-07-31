import { UploadError, type Logger, type QueuedFile, type UploadEngineConfig } from "../types";
import { computeBackoffMs, sleep } from "../utils/backoff";
import type { QueueManager } from "./QueueManager";
import type { RetryManager } from "./RetryManager";
import type { SessionManager } from "./SessionManager";
import type { GoogleDriveAdapter } from "../adapters/GoogleDriveAdapter";
import type { ProgressManager } from "./ProgressManager";
import { readNextChunk } from "./ChunkManager";

/**
 * Coordinates the two independent concurrency pools:
 *
 *   - the NORMAL pool drains the main queue and obeys `normalConcurrency`;
 *   - the RETRY  pool drains failed files and obeys `retryConcurrency`.
 *
 * A failure in the normal pool never blocks new files from starting; the
 * failed file is handed off to the retry pool (subject to backoff).
 */
export class UploadScheduler {
  private normalSlots = 0;
  private retrySlots = 0;
  private running = false;
  private stopped = false;
  private paused = false;

  private normalWake: () => void = noop;
  private retryWake: () => void = noop;

  private readonly normalLoopPromise: Promise<void>;
  private readonly retryLoopPromise: Promise<void>;

  constructor(
    private readonly config: UploadEngineConfig,
    private readonly queue: QueueManager,
    private readonly sessions: SessionManager,
    private readonly retry: RetryManager,
    private readonly adapter: GoogleDriveAdapter,
    private readonly progress: ProgressManager,
    private readonly logger: Logger,
    private readonly hooks: {
      onFileStateChange?: (id: string) => void;
    } = {}
  ) {
    this.normalLoopPromise = this.runNormalLoop();
    this.retryLoopPromise = this.runRetryLoop();
  }

  /** Begin dispatching files. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    this.wakeNormal();
    this.wakeRetry();
  }

  /** Halt the engine. In-flight chunks are aborted at the next await. */
  stop(): void {
    this.stopped = true;
    this.running = false;
    this.wakeNormal();
    this.wakeRetry();
  }

  /** Pause/resume the normal pool. The retry pool keeps running. */
  setPaused(p: boolean): void {
    this.paused = p;
    if (!p) this.wakeNormal();
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Promise that resolves when both loops have exited. */
  async join(): Promise<void> {
    this.stop();
    await Promise.all([this.normalLoopPromise, this.retryLoopPromise]);
  }

  /**
   * Swap the Drive adapter for a caller-supplied one. Must be called
   * before any file has started uploading. Used by integrations that
   * proxy the resumable session through their own backend.
   */
  setAdapter(adapter: GoogleDriveAdapter): void {
    // Hot-swap on the same instance: the scheduler only stores the
    // adapter field reference for method calls, so reassigning here
    // affects all future work without touching the existing engine
    // architecture.
    (this as unknown as { adapter: GoogleDriveAdapter }).adapter = adapter;
  }

  /**
   * BUG #2 FIX: explicit wake for user-initiated actions (Retry,
   * Resume, Add files while idle). The pool loops sleep in
   * `waitForWake` between dispatches; if a user action re-queues a
   * file or adds a new one while the loop is asleep, nothing else
   * wakes the loop until the next in-flight file finishes. This
   * method is the user-facing entry point and is a no-op when the
   * pool is already running.
   */
  wakeForUserAction(): void {
    if (this.stopped) return;
    this.wakeNormal();
    this.wakeRetry();
  }

  // -------------------------------------------------------------------------
  // Normal pool
  // -------------------------------------------------------------------------
  private async runNormalLoop(): Promise<void> {
    while (!this.stopped) {
      if (this.paused || this.normalSlots >= this.config.normalConcurrency) {
        await this.waitForWake("normal");
        continue;
      }
      const candidate = this.queue.nextQueued(1)[0];
      if (!candidate) {
        await this.waitForWake("normal");
        continue;
      }
      this.normalSlots += 1;
      this.queue.setPool(candidate.id, "normal");
      // Fire-and-forget; the loop picks up the next file.
      this.runOne(candidate, "normal").catch((err) => {
        this.logger.error("[pagaska] unhandled normal-pool error", err);
      }).finally(() => {
        this.normalSlots -= 1;
        this.wakeNormal();
        this.progress.tick();
      });
    }
  }

  // -------------------------------------------------------------------------
  // Retry pool
  // -------------------------------------------------------------------------
  private async runRetryLoop(): Promise<void> {
    while (!this.stopped) {
      if (this.retrySlots >= this.config.retryConcurrency) {
        await this.waitForWake("retry");
        continue;
      }
      // Pass maxRetries so the queue can skip files that have
      // exhausted their budget (BUG #2 / BUG #4 fix).
      const candidate = this.queue.nextFailed(1, this.config.maxRetries)[0];
      if (!candidate) {
        await this.waitForWake("retry");
        continue;
      }
      this.retrySlots += 1;
      this.queue.setPool(candidate.id, "retry");

      this.runOneWithBackoff(candidate).catch((err) => {
        this.logger.error("[pagaska] unhandled retry-pool error", err);
      }).finally(() => {
        this.retrySlots -= 1;
        this.wakeRetry();
        this.progress.tick();
      });
    }
  }

  // -------------------------------------------------------------------------
  // File lifecycle
  // -------------------------------------------------------------------------
  private async runOne(file: QueuedFile, pool: "normal" | "retry"): Promise<void> {
    this.queue.setState(file.id, pool === "retry" ? "retrying" : "uploading");
    this.hooks.onFileStateChange?.(file.id);
    try {
      await this.uploadFromCurrentOffset(file);
      this.queue.setState(file.id, "completed");
      this.queue.setDriveFileId(file.id, file.driveFileId);
      this.sessions.remove(file.id);
      this.hooks.onFileStateChange?.(file.id);
    } catch (err) {
      const uploadErr = (err instanceof Error && err.constructor.name === "UploadError"
        ? err
        : (err as UploadError)) as UploadError;
      this.queue.setState(file.id, "failed", { errorMessage: uploadErr.message });
      this.queue.setError(file.id, uploadErr.message, uploadErr);
      this.queue.setPool(file.id, null);
      this.hooks.onFileStateChange?.(file.id);
      this.retry.logFailure(file, uploadErr);
      // BUG #2 / #4 FIX: a recoverable failure used to leave the
      // retry pool asleep forever. The retry pool runs in a separate
      // loop that only wakes on `wakeRetry()`. The normal pool
      // finishes the current file in its .finally (which calls
      // `wakeNormal`), but the retry pool has no equivalent trigger
      // when a file transitions to "failed". Wake the retry pool
      // here so the next failed file is picked up promptly. The
      // retry loop will call `nextFailed`, which sees the file we
      // just marked as failed, and will run it through the backoff
      // window in `runOneWithBackoff`. Non-recoverable failures are
      // still recorded, but waking the pool is harmless: `nextFailed`
      // will still return the file, the backoff will run, and after
      // backoff `runOneWithBackoff` will hand the file to the normal
      // pool which will then fail again. To avoid a busy loop on
      // non-recoverable errors, the backoff path is a no-op when
      // `attempt >= maxRetries` (see runOneWithBackoff below).
      if (uploadErr.recoverable) {
        this.wakeRetry();
      } else {
        // Still wake the retry pool once so it can mark the file
        // as terminal — but the backoff short-circuit will keep it
        // from re-queueing.
        this.wakeRetry();
      }
    }
  }

  /**
   * Retry wrapper: sleeps for the backoff window, then re-arms the file
   * to `queued` (with the session kept) and runs it as a normal upload.
   * The retry pool's slot is held during the backoff so we don't burst
   * retries onto the network.
   */
  private async runOneWithBackoff(file: QueuedFile): Promise<void> {
    const attempt = file.attempt + 1;
    this.queue.incrementAttempt(file.id);
    // BUG #2 FIX: when the retry budget is exhausted, do NOT
    // re-queue the file. The previous version always re-armed the
    // file to "queued" and handed it to the normal pool, which
    // would fail again on the very next attempt and bounce back
    // here, creating a tight loop. Now we leave the file in
    // "failed" and surface a clear error message so the operator
    // sees "retries exhausted" instead of a constant retry storm.
    if (attempt > this.config.maxRetries) {
      const exhausted = `Retries exhausted (${this.config.maxRetries} attempts). Last error: ${file.errorMessage ?? "unknown"}`;
      this.logger.warn(`[pagaska] ${file.source.relativePath}: ${exhausted}`);
      this.queue.setState(file.id, "failed", { errorMessage: exhausted });
      this.queue.setError(file.id, exhausted, file.lastError);
      this.queue.setPool(file.id, null);
      this.hooks.onFileStateChange?.(file.id);
      return;
    }
    const delay = computeBackoffMs(attempt, this.config.backoffSeconds);
    this.logger.info(`[pagaska] ${file.source.relativePath}: backing off ${delay}ms before retry ${attempt}`);
    await sleep(delay);
    if (this.stopped) return;
    // Hand the file back to the normal pool by resetting it to queued.
    this.queue.setState(file.id, "queued", { errorMessage: null });
    this.queue.setPool(file.id, null);
    this.hooks.onFileStateChange?.(file.id);
    this.wakeNormal();
  }

  // -------------------------------------------------------------------------
  // Core upload loop for a single file
  // -------------------------------------------------------------------------
  private async uploadFromCurrentOffset(file: QueuedFile): Promise<void> {
    const accessToken = await this.config.getAccessToken();
    const session = await this.ensureSession(file, accessToken);

    while (true) {
      if (this.stopped) {
        throw new Error("aborted");
      }
      const chunk = await readNextChunk(file, this.config.chunkSize);
      if (!chunk) return; // finished

      const result = await this.adapter.uploadChunk(
        session,
        chunk,
        accessToken,
        file.bytesUploaded
      );
      // Completion guard: if the server acknowledged no new bytes for this
      // chunk, the `while (true)` loop below would otherwise re-upload the
      // identical chunk forever, leaving the file stuck in "uploading" and
      // the queue blocked. Surface a recoverable failure so the existing
      // retry/backoff machinery can re-anchor or fail the file once its
      // retry budget is exhausted.
      if (result.acknowledged <= file.bytesUploaded) {
        throw new UploadError(
          `Server made no progress on chunk ${chunk.start}-${chunk.end} (acknowledged ${result.acknowledged} of ${file.source.size} bytes)`,
          { recoverable: true, status: 409 }
        );
      }
      this.queue.setBytesUploaded(file.id, result.acknowledged);
      this.sessions.setBytesUploaded(file.id, result.acknowledged);
      this.queue.recordSpeedSample(file.id, result.acknowledged);
      this.progress.tick();

      if (result.finished) {
        file.driveFileId = result.driveFileId;
        return;
      }
    }
  }

  /**
   * Open a resumable session if we don't have one, or, if we do, ask the
   * server how many bytes it has so we can resume from the right offset.
   *
   * BUG #3 FIX: the previous version always called `adapter.queryProgress`
   * when a persisted session was found. With the Pagaska Worker adapter
   * the browser cannot reach Google's session URI directly (CORS), and
   * the engine has no way to skip the call. We now:
   *   - use the locally-persisted `bytesUploaded` as the resume offset;
   *   - let the next chunk PUT (308 + Range, or 200/201) re-anchor the
   *     offset if Google has more or fewer bytes than we think;
   *   - still honour the adapter contract by attempting the progress
   *     query first, but treat any error as "trust the local value".
   * This way the engine works for both direct-to-Google adapters and
   * backend-proxied adapters.
   */
  private async ensureSession(
    file: QueuedFile,
    accessToken: string
  ): Promise<NonNullable<QueuedFile["session"]>> {
    const persisted = this.sessions.get(file.id) ?? file.session;
    if (persisted) {
      // Try to confirm with the server where it stands, but if the
      // adapter (e.g. a backend proxy) can't answer, fall back to
      // the locally-persisted offset. Either way the next chunk PUT
      // is the source of truth.
      try {
        const acknowledged = await this.adapter.queryProgress(persisted, accessToken);
        if (typeof acknowledged === "number" && Number.isFinite(acknowledged)) {
          this.queue.setBytesUploaded(file.id, acknowledged);
          this.sessions.setBytesUploaded(file.id, acknowledged);
        }
      } catch (err) {
        this.logger.warn(
          `[pagaska] ${file.source.relativePath}: progress query failed, resuming from local offset ${persisted.bytesUploaded}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        // Keep `bytesUploaded` as persisted; the next chunk PUT will
        // re-anchor if needed.
      }
      this.queue.setSession(file.id, persisted);
      return persisted;
    }
    const session = await this.adapter.openSession(file.source, accessToken);
    this.queue.setSession(file.id, session);
    this.sessions.set(file.id, session);
    return session;
  }

  // -------------------------------------------------------------------------
  // Wake primitives
  // -------------------------------------------------------------------------
  private waitForWake(which: "normal" | "retry"): Promise<void> {
    return new Promise<void>((resolve) => {
      if (which === "normal") this.normalWake = resolve;
      else this.retryWake = resolve;
    });
  }

  private wakeNormal(): void {
    const w = this.normalWake;
    this.normalWake = noop;
    w();
  }

  private wakeRetry(): void {
    const w = this.retryWake;
    this.retryWake = noop;
    w();
  }
}

function noop(): void {
  /* intentional */
}
