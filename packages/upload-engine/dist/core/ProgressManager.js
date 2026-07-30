/**
 * Aggregates per-file progress into a single snapshot the UI can render.
 *
 * Speed is averaged over the last ~3 seconds of samples so the displayed
 * number doesn't jitter wildly.
 */
export class ProgressManager {
    queue;
    onProgress;
    lastEmit = 0;
    emitIntervalMs = 100;
    constructor(queue, onProgress) {
        this.queue = queue;
        this.onProgress = onProgress;
    }
    /** Call this after any progress-affecting mutation. Throttles emissions. */
    tick() {
        const now = Date.now();
        if (!this.onProgress)
            return;
        if (now - this.lastEmit < this.emitIntervalMs)
            return;
        this.lastEmit = now;
        this.onProgress(this.snapshot());
    }
    /** Force-emit a snapshot regardless of throttle. */
    forceEmit() {
        if (!this.onProgress)
            return;
        this.lastEmit = Date.now();
        this.onProgress(this.snapshot());
    }
    snapshot() {
        const all = this.queue.all();
        let totalBytes = 0;
        let uploadedBytes = 0;
        let totalFiles = 0;
        let uploadedFiles = 0;
        let failedFiles = 0;
        let retryingFiles = 0;
        let queuedFiles = 0;
        let current = [];
        let speedSum = 0;
        const now = Date.now();
        for (const f of all) {
            totalBytes += f.source.size;
            uploadedBytes += f.bytesUploaded;
            totalFiles += 1;
            switch (f.state) {
                case "completed":
                    uploadedFiles += 1;
                    break;
                case "failed":
                    failedFiles += 1;
                    break;
                case "retrying":
                    retryingFiles += 1;
                    current.push(this.queue.snapshot(f.id));
                    break;
                case "uploading":
                    current.push(this.queue.snapshot(f.id));
                    break;
                case "queued":
                    queuedFiles += 1;
                    break;
                default:
                    break;
            }
            if (f.state === "uploading" || f.state === "retrying") {
                speedSum += this.queue.speedFor(f.id);
            }
        }
        const remainingBytes = Math.max(0, totalBytes - uploadedBytes);
        const remainingSeconds = speedSum > 0 ? remainingBytes / speedSum : null;
        const fraction = totalBytes > 0 ? Math.min(1, uploadedBytes / totalBytes) : 0;
        return {
            totalBytes,
            uploadedBytes,
            totalFiles,
            uploadedFiles,
            failedFiles,
            retryingFiles,
            queuedFiles,
            currentFiles: current,
            overallSpeedBps: speedSum,
            remainingSeconds,
            fraction,
            // touch `now` so the analyzer doesn't flag it as unused in the
            // future if we add a "stale" detector.
            ...(now ? {} : {}),
        };
    }
}
//# sourceMappingURL=ProgressManager.js.map