import { computeBackoffMs, sleep } from "../utils/backoff";
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
    config;
    queue;
    sessions;
    retry;
    adapter;
    progress;
    logger;
    hooks;
    normalSlots = 0;
    retrySlots = 0;
    running = false;
    stopped = false;
    paused = false;
    normalWake = noop;
    retryWake = noop;
    normalLoopPromise;
    retryLoopPromise;
    constructor(config, queue, sessions, retry, adapter, progress, logger, hooks = {}) {
        this.config = config;
        this.queue = queue;
        this.sessions = sessions;
        this.retry = retry;
        this.adapter = adapter;
        this.progress = progress;
        this.logger = logger;
        this.hooks = hooks;
        this.normalLoopPromise = this.runNormalLoop();
        this.retryLoopPromise = this.runRetryLoop();
    }
    /** Begin dispatching files. */
    start() {
        if (this.running)
            return;
        this.running = true;
        this.stopped = false;
        this.wakeNormal();
        this.wakeRetry();
    }
    /** Halt the engine. In-flight chunks are aborted at the next await. */
    stop() {
        this.stopped = true;
        this.running = false;
        this.wakeNormal();
        this.wakeRetry();
    }
    /** Pause/resume the normal pool. The retry pool keeps running. */
    setPaused(p) {
        this.paused = p;
        if (!p)
            this.wakeNormal();
    }
    isPaused() {
        return this.paused;
    }
    /** Promise that resolves when both loops have exited. */
    async join() {
        this.stop();
        await Promise.all([this.normalLoopPromise, this.retryLoopPromise]);
    }
    /**
     * Swap the Drive adapter for a caller-supplied one. Must be called
     * before any file has started uploading. Used by integrations that
     * proxy the resumable session through their own backend.
     */
    setAdapter(adapter) {
        // Hot-swap on the same instance: the scheduler only stores the
        // adapter field reference for method calls, so reassigning here
        // affects all future work without touching the existing engine
        // architecture.
        this.adapter = adapter;
    }
    // -------------------------------------------------------------------------
    // Normal pool
    // -------------------------------------------------------------------------
    async runNormalLoop() {
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
    async runRetryLoop() {
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
    async runOne(file, pool) {
        this.queue.setState(file.id, pool === "retry" ? "retrying" : "uploading");
        this.hooks.onFileStateChange?.(file.id);
        try {
            await this.uploadFromCurrentOffset(file);
            this.queue.setState(file.id, "completed");
            this.queue.setDriveFileId(file.id, file.driveFileId);
            this.sessions.remove(file.id);
            this.hooks.onFileStateChange?.(file.id);
        }
        catch (err) {
            const uploadErr = (err instanceof Error && err.constructor.name === "UploadError"
                ? err
                : err);
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
    async runOneWithBackoff(file) {
        const attempt = file.attempt + 1;
        this.queue.incrementAttempt(file.id);
        const delay = computeBackoffMs(attempt, this.config.backoffSeconds);
        this.logger.info(`[pagaska] ${file.source.relativePath}: backing off ${delay}ms before retry ${attempt}`);
        await sleep(delay);
        if (this.stopped)
            return;
        // Hand the file back to the normal pool by resetting it to queued.
        this.queue.setState(file.id, "queued", { errorMessage: null });
        this.queue.setPool(file.id, null);
        this.hooks.onFileStateChange?.(file.id);
        this.wakeNormal();
    }
    // -------------------------------------------------------------------------
    // Core upload loop for a single file
    // -------------------------------------------------------------------------
    async uploadFromCurrentOffset(file) {
        const accessToken = await this.config.getAccessToken();
        const session = await this.ensureSession(file, accessToken);
        while (true) {
            if (this.stopped) {
                throw new Error("aborted");
            }
            const chunk = await readNextChunk(file, this.config.chunkSize);
            if (!chunk)
                return; // finished
            const result = await this.adapter.uploadChunk(session, chunk, accessToken, file.bytesUploaded);
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
    async ensureSession(file, accessToken) {
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
    waitForWake(which) {
        return new Promise((resolve) => {
            if (which === "normal")
                this.normalWake = resolve;
            else
                this.retryWake = resolve;
        });
    }
    wakeNormal() {
        const w = this.normalWake;
        this.normalWake = noop;
        w();
    }
    wakeRetry() {
        const w = this.retryWake;
        this.retryWake = noop;
        w();
    }
}
function noop() {
    /* intentional */
}
//# sourceMappingURL=UploadScheduler.js.map