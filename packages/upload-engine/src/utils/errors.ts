import { UploadError, isRecoverableStatus } from "../types";

/**
 * Wraps any thrown value into an UploadError, classifying it as recoverable
 * or not based on its HTTP status (if any) or the type of failure.
 */
export function toUploadError(err: unknown): UploadError {
  if (err instanceof UploadError) return err;
  if (err instanceof Error) {
    // AbortError from fetch timeouts is recoverable.
    const isAbort = err.name === "AbortError";
    return new UploadError(err.message, { recoverable: isAbort, cause: err });
  }
  return new UploadError(String(err), { recoverable: false, cause: err });
}

/**
 * Build an UploadError from a non-2xx HTTP response.
 */
export function httpError(status: number, body: string): UploadError {
  return new UploadError(`HTTP ${status}: ${body.slice(0, 256)}`, {
    recoverable: isRecoverableStatus(status),
    status,
  });
}
