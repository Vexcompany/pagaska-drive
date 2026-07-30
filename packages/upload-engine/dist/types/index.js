/**
 * Core type definitions for the Pagaska Drive upload engine.
 *
 * Everything is intentionally serializable so that queue state, progress,
 * and resumable session metadata can be persisted to localStorage and
 * restored after a page refresh.
 */
/** Distinguishes errors the engine can recover from. */
export class UploadError extends Error {
    recoverable;
    status;
    cause;
    constructor(message, options = { recoverable: false }) {
        super(message);
        this.name = "UploadError";
        this.recoverable = options.recoverable;
        this.status = options.status ?? null;
        this.cause = options.cause;
    }
}
export const isRecoverableStatus = (status) => {
    if (status === null)
        return true; // network failure etc.
    if (status === 408 || status === 425 || status === 429)
        return true;
    if (status >= 500 && status < 600)
        return true;
    return false;
};
//# sourceMappingURL=index.js.map