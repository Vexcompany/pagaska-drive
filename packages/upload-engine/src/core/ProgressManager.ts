import type { ProgressSnapshot, UploadFileSnapshot } from "../types";
import type { QueueManager } from "./QueueManager";

/**
 * Aggregates per-file progress into a single snapshot the UI can render.
 *
 * Speed is averaged over the last ~3 seconds of samples so the displayed
 * number doesn't jitter wildly.
 */
export class ProgressManager {
  private lastEmit = 0;
  private readonly emitIntervalMs = 100;

  constructor(
    private readonly queue: QueueManager,
    private readonly onProgress?: (snapshot: ProgressSnapshot) => void
  ) {}

  /** Call this after any progress-affecting mutation. Throttles emissions. */
  tick(): void {
    const now = Date.now();
    if (!this.onProgress) return;
    const snapshot = this.snapshot();
    // `currentFiles` holds the "uploading"/"retrying" rows; a non-zero
    // queued/retrying count or a non-empty current list means work is
    // still in flight, so keep throttling to ~10 Hz. Once every file has
    // reached a terminal state (completed/failed/canceled/paused) the
    // throttle must NOT swallow the final snapshot: the completion tick
    // usually fires within the same millisecond as the last chunk tick,
    // so a throttled emit here would leave the UI stuck on an outdated
    // summary (e.g. "0 / 1 files, completed: 0") forever, because no
    // further tick ever happens.
    const stillActive =
      snapshot.queuedFiles > 0 ||
      snapshot.retryingFiles > 0 ||
      snapshot.currentFiles.length > 0;
    if (!stillActive || now - this.lastEmit >= this.emitIntervalMs) {
      this.lastEmit = now;
      this.onProgress(snapshot);
    }
  }

  /** Force-emit a snapshot regardless of throttle. */
  forceEmit(): void {
    if (!this.onProgress) return;
    this.lastEmit = Date.now();
    this.onProgress(this.snapshot());
  }

  snapshot(): ProgressSnapshot {
    const all = this.queue.all();
    let totalBytes = 0;
    let uploadedBytes = 0;
    let totalFiles = 0;
    let uploadedFiles = 0;
    let failedFiles = 0;
    let retryingFiles = 0;
    let queuedFiles = 0;
    let current: UploadFileSnapshot[] = [];
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
          current.push(this.queue.snapshot(f.id)!);
          break;
        case "uploading":
          current.push(this.queue.snapshot(f.id)!);
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
      ...(now ? {} : {}),
    };
  }
}
