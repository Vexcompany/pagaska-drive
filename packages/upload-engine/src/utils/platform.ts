import type { SessionStorage } from "../types";

/**
 * Returns a SessionStorage backed by `localStorage` when running in a
 * browser. On the server (Node, no window) it returns a no-op in-memory
 * store so the engine can be unit-tested without a DOM.
 */
export function defaultSessionStorage(key: string): SessionStorage {
  const isBrowser =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { localStorage?: Storage }).localStorage !== "undefined";

  if (!isBrowser) {
    let mem: Record<string, never> = {};
    return {
      read: () => ({ ...mem }),
      write: (data) => {
        mem = { ...data } as Record<string, never>;
      },
      clear: () => {
        mem = {};
      },
    };
  }

  const storage = (globalThis as { localStorage: Storage }).localStorage;
  return {
    read: () => {
      try {
        const raw = storage.getItem(key);
        return raw ? (JSON.parse(raw) as Record<string, never>) : {};
      } catch {
        return {};
      }
    },
    write: (data) => {
      try {
        storage.setItem(key, JSON.stringify(data));
      } catch {
        // Quota exceeded or storage disabled — fail silently; the engine
        // will simply not be able to resume across page reloads.
      }
    },
    clear: () => {
      try {
        storage.removeItem(key);
      } catch {
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
export function generateId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
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
