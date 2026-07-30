import type { Logger, QueuedFile, UploadEngineConfig, UploadError } from "../types";
import { computeBackoffMs } from "../utils/backoff";

/**
 * Decides whether a failed upload should be retried and, if so, after
 * how long.
 *
 * Rules:
 *   - Only recoverable errors are retried.
 *   - The retry budget is `maxRetries` (configurable).
 *   - The delay is `backoffSeconds[attempt - 1]`, exponential by default.
 */
export class RetryManager {
  constructor(
    private readonly config: UploadEngineConfig,
    private readonly logger: Logger
  ) {}

  shouldRetry(file: QueuedFile, err: UploadError): boolean {
    if (!err.recoverable) return false;
    if (file.attempt >= this.config.maxRetries) return false;
    return true;
  }

  /**
   * Returns the wall-clock delay (ms) before the next attempt, or 0 if
   * the file has exhausted its budget. Computes a timestamp rather than
   * sleeping so the scheduler can interleave many retries.
   */
  delayMsFor(file: QueuedFile): number {
    if (file.attempt <= 0) return 0;
    return computeBackoffMs(file.attempt, this.config.backoffSeconds);
  }

  /** Human-readable description of the upcoming retry for the UI. */
  describe(file: QueuedFile): string {
    if (file.attempt >= this.config.maxRetries) return "no retries left";
    const sec = this.config.backoffSeconds[Math.min(file.attempt - 1, this.config.backoffSeconds.length - 1)] ?? 0;
    return `retry ${file.attempt + 1}/${this.config.maxRetries} in ${sec}s`;
  }

  logFailure(file: QueuedFile, err: UploadError): void {
    this.logger.warn(
      `[pagaska] ${file.source.relativePath} attempt ${file.attempt} failed: ${err.message} (recoverable=${err.recoverable})`
    );
  }
}
