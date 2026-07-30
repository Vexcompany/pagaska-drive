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
    config;
    logger;
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
    }
    shouldRetry(file, err) {
        if (!err.recoverable)
            return false;
        if (file.attempt >= this.config.maxRetries)
            return false;
        return true;
    }
    /**
     * Returns the wall-clock delay (ms) before the next attempt, or 0 if
     * the file has exhausted its budget. Computes a timestamp rather than
     * sleeping so the scheduler can interleave many retries.
     */
    delayMsFor(file) {
        if (file.attempt <= 0)
            return 0;
        return computeBackoffMs(file.attempt, this.config.backoffSeconds);
    }
    /** Human-readable description of the upcoming retry for the UI. */
    describe(file) {
        if (file.attempt >= this.config.maxRetries)
            return "no retries left";
        const sec = this.config.backoffSeconds[Math.min(file.attempt - 1, this.config.backoffSeconds.length - 1)] ?? 0;
        return `retry ${file.attempt + 1}/${this.config.maxRetries} in ${sec}s`;
    }
    logFailure(file, err) {
        this.logger.warn(`[pagaska] ${file.source.relativePath} attempt ${file.attempt} failed: ${err.message} (recoverable=${err.recoverable})`);
    }
}
//# sourceMappingURL=RetryManager.js.map