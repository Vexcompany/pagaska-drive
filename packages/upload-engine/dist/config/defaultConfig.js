const MB = 1024 * 1024;
/**
 * Production defaults. Every value can be overridden through the
 * UploadEngine constructor or by spreading a partial config.
 */
export const defaultConfig = {
    chunkSize: 8 * MB,
    normalConcurrency: 4,
    retryConcurrency: 1,
    maxRetries: 5,
    backoffSeconds: [3, 8, 20, 45, 90],
    requestTimeoutMs: 60_000,
    parentFolderId: null,
    sessionPersistKey: "pagaska.upload.sessions.v1",
};
/**
 * Validates an engine config and throws a descriptive error if any value
 * is out of range. Keeping this separate from the constructor lets callers
 * validate a config object before instantiating the engine.
 */
export function validateConfig(config) {
    if (config.chunkSize !== undefined) {
        if (config.chunkSize < 256 * 1024) {
            throw new Error("chunkSize must be at least 256 KB (Google Drive minimum chunk).");
        }
        if ((config.chunkSize & (config.chunkSize - 1)) !== 0) {
            throw new Error("chunkSize should be a power of two for clean slicing.");
        }
    }
    if (config.normalConcurrency !== undefined && config.normalConcurrency < 1) {
        throw new Error("normalConcurrency must be >= 1.");
    }
    if (config.retryConcurrency !== undefined && config.retryConcurrency < 1) {
        throw new Error("retryConcurrency must be >= 1.");
    }
    if (config.maxRetries !== undefined && config.maxRetries < 0) {
        throw new Error("maxRetries must be >= 0.");
    }
    if (config.backoffSeconds !== undefined && config.backoffSeconds.length === 0) {
        throw new Error("backoffSeconds must contain at least one entry.");
    }
}
//# sourceMappingURL=defaultConfig.js.map