import type { ResumableSession, SessionStorage } from "../types";

/**
 * Persists Google Drive resumable session URIs so an upload can be
 * resumed after the page is closed, refreshed, or crashes.
 *
 * The session URI is keyed by the engine's internal file id; a different
 * Drive session is opened for every file because Google Drive's resumable
 * upload protocol is one session per logical file.
 */
export class SessionManager {
  private readonly storage: SessionStorage;
  private cache: Record<string, ResumableSession>;

  constructor(storage: SessionStorage) {
    this.storage = storage;
    this.cache = storage.read();
  }

  /** Retrieve a previously-saved session for the given file id. */
  get(fileId: string): ResumableSession | null {
    return this.cache[fileId] ?? null;
  }

  /** Save or replace a session. Persists synchronously. */
  set(fileId: string, session: ResumableSession): void {
    this.cache[fileId] = session;
    this.flush();
  }

  /** Update just the bytes-uploaded counter after each successful chunk. */
  setBytesUploaded(fileId: string, bytesUploaded: number): void {
    const existing = this.cache[fileId];
    if (!existing) return;
    existing.bytesUploaded = bytesUploaded;
    this.flush();
  }

  /** Remove the session for a file (e.g. when the upload completes or is canceled). */
  remove(fileId: string): void {
    delete this.cache[fileId];
    this.flush();
  }

  /** Wipe all persisted sessions — used by the "Cancel all" action. */
  clear(): void {
    this.cache = {};
    this.storage.clear();
  }

  private flush(): void {
    this.storage.write(this.cache);
  }
}
