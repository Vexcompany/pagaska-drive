/**
 * Returns the delay (ms) before the Nth retry attempt.
 *
 * `attempt` is 1-based: attempt=1 means the FIRST retry, which uses
 * `backoffSeconds[0]`. If the table is shorter than the attempt number,
 * the last value is reused (capped behavior).
 */
export function computeBackoffMs(
  attempt: number,
  backoffSeconds: readonly number[]
): number {
  if (attempt <= 0) return 0;
  const idx = Math.min(attempt - 1, backoffSeconds.length - 1);
  const seconds = backoffSeconds[Math.max(0, idx)];
  return Math.max(0, Math.floor(seconds * 1000));
}

/**
 * Sleep for `ms` milliseconds, abortable via the optional signal.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
