import type { Logger, QueuedFile, UploadEngineConfig, UploadError } from "../types";
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
      const candidate = this.queue.nextFailed(1)[0];
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
   */
  private async ensureSession(
    file: QueuedFile,
    accessToken: string
  ): Promise<NonNullable<QueuedFile["session"]>> {
    const persisted = this.sessions.get(file.id) ?? file.session;
    if (persisted) {
      // Confirm with the server where it stands.
      const acknowledged = await this.adapter.queryProgress(persisted, accessToken);
      this.queue.setBytesUploaded(file.id, acknowledged);
      this.sessions.setBytesUploaded(file.id, acknowledged);
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
