/**
 * Returns a SessionStorage backed by `localStorage` when running in a
 * browser. On the server (Node, no window) it returns a no-op in-memory
 * store so the engine can be unit-tested without a DOM.
 */
export function defaultSessionStorage(key) {
    const isBrowser = typeof globalThis !== "undefined" &&
        typeof globalThis.localStorage !== "undefined";
    if (!isBrowser) {
        let mem = {};
        return {
            read: () => ({ ...mem }),
            write: (data) => {
                mem = { ...data };
            },
            clear: () => {
                mem = {};
            },
        };
    }
    const storage = globalThis.localStorage;
    return {
        read: () => {
            try {
                const raw = storage.getItem(key);
                return raw ? JSON.parse(raw) : {};
            }
            catch {
                return {};
            }
        },
        write: (data) => {
            try {
                storage.setItem(key, JSON.stringify(data));
            }
            catch {
                // Quota exceeded or storage disabled — fail silently; the engine
                // will simply not be able to resume across page reloads.
            }
        },
        clear: () => {
            try {
                storage.removeItem(key);
            }
            catch {
                // ignore
            }
        },
    };
}
/**
 * Generates a short, collision-resistant id for files in the queue.
 * Uses crypto.randomUUID when available, falls back to a Math.random
 * implementation for very old runtimes.
 */
export function generateId() {
    const c = globalThis.crypto;
    if (c?.randomUUID)
        return c.randomUUID();
    return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
/**
 * A no-op logger. Consumers can pass a real one to surface events.
 */
export const nullLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};
//# sourceMappingURL=platform.js.map