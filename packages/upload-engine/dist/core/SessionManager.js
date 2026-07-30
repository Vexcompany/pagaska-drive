/**
 * Persists Google Drive resumable session URIs so an upload can be
 * resumed after the page is closed, refreshed, or crashes.
 *
 * The session URI is keyed by the engine's internal file id; a different
 * Drive session is opened for every file because Google Drive's resumable
 * upload protocol is one session per logical file.
 */
export class SessionManager {
    storage;
    cache;
    constructor(storage) {
        this.storage = storage;
        this.cache = storage.read();
    }
    /** Retrieve a previously-saved session for the given file id. */
    get(fileId) {
        return this.cache[fileId] ?? null;
    }
    /** Save or replace a session. Persists synchronously. */
    set(fileId, session) {
        this.cache[fileId] = session;
        this.flush();
    }
    /** Update just the bytes-uploaded counter after each successful chunk. */
    setBytesUploaded(fileId, bytesUploaded) {
        const existing = this.cache[fileId];
        if (!existing)
            return;
        existing.bytesUploaded = bytesUploaded;
        this.flush();
    }
    /** Remove the session for a file (e.g. when the upload completes or is canceled). */
    remove(fileId) {
        delete this.cache[fileId];
        this.flush();
    }
    /** Wipe all persisted sessions — used by the "Cancel all" action. */
    clear() {
        this.cache = {};
        this.storage.clear();
    }
    flush() {
        this.storage.write(this.cache);
    }
}
//# sourceMappingURL=SessionManager.js.map