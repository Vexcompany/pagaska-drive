import { generateId } from "../utils/platform";
/**
 * Owns the file list and per-file state machine.
 *
 * This class is intentionally decoupled from the scheduler: the scheduler
 * pulls "ready" files from it, and the queue reacts to state changes
 * reported back by the scheduler. That makes both easy to unit test.
 */
export class QueueManager {
    files = new Map();
    order = [];
    /** Add one or more files to the queue. Returns the new ids. */
    add(sources) {
        const ids = [];
        for (const src of sources) {
            const id = generateId();
            const file = {
                id,
                source: src,
                state: "queued",
                pool: null,
                attempt: 0,
                bytesUploaded: 0,
                errorMessage: null,
                driveFileId: null,
                startedAt: null,
                completedAt: null,
                session: null,
                lastError: null,
                speedSamples: [],
            };
            this.files.set(id, file);
            this.order.push(id);
            ids.push(id);
        }
        return ids;
    }
    /** Number of files currently in the queue (any state). */
    size() {
        return this.files.size;
    }
    get(id) {
        return this.files.get(id);
    }
    /**
     * Returns up to `n` queued files that the normal pool can pick up.
     * Skips files already assigned to a pool, paused, or finished.
     */
    nextQueued(n) {
        const out = [];
        for (const id of this.order) {
            if (out.length >= n)
                break;
            const f = this.files.get(id);
            if (!f)
                continue;
            if (f.state === "queued" && f.pool === null) {
                out.push(f);
            }
        }
        return out;
    }
    /**
     * Returns up to `n` files currently in `failed` state. The retry pool
     * pulls from this list.
     */
    nextFailed(n) {
        const out = [];
        for (const id of this.order) {
            if (out.length >= n)
                break;
            const f = this.files.get(id);
            if (!f)
                continue;
            if (f.state === "failed" && f.pool === null) {
                out.push(f);
            }
        }
        return out;
    }
    /** Returns up to `n` files that are paused and waiting for resume. */
    nextPaused(n) {
        const out = [];
        for (const id of this.order) {
            if (out.length >= n)
                break;
            const f = this.files.get(id);
            if (!f)
                continue;
            if (f.state === "paused" && f.pool === null) {
                out.push(f);
            }
        }
        return out;
    }
    /** All files, in queue order. */
    all() {
        return this.order.map((id) => this.files.get(id)).filter(Boolean);
    }
    /** Files in any of the given states. */
    filter(states) {
        return this.all().filter((f) => states.includes(f.state));
    }
    /** Reset failed files back to queued so they can be re-picked. */
    resetFailedToQueued(ids) {
        let count = 0;
        for (const f of this.all()) {
            const match = !ids || ids.includes(f.id);
            if (match && f.state === "failed") {
                f.state = "queued";
                f.errorMessage = null;
                f.attempt = 0;
                f.lastError = null;
                count++;
            }
        }
        return count;
    }
    setState(id, state, opts = {}) {
        const f = this.files.get(id);
        if (!f)
            return;
        f.state = state;
        if (opts.errorMessage !== undefined)
            f.errorMessage = opts.errorMessage;
        if (state === "uploading" && f.startedAt === null)
            f.startedAt = Date.now();
        if (state === "completed")
            f.completedAt = Date.now();
        if (state === "uploading" || state === "retrying")
            f.pool = f.state === "retrying" ? "retry" : "normal";
    }
    setPool(id, pool) {
        const f = this.files.get(id);
        if (f)
            f.pool = pool;
    }
    setBytesUploaded(id, bytes) {
        const f = this.files.get(id);
        if (f)
            f.bytesUploaded = bytes;
    }
    setDriveFileId(id, driveFileId) {
        const f = this.files.get(id);
        if (f)
            f.driveFileId = driveFileId;
    }
    setSession(id, session) {
        const f = this.files.get(id);
        if (f)
            f.session = session;
    }
    setError(id, message, lastError) {
        const f = this.files.get(id);
        if (!f)
            return;
        f.errorMessage = message;
        f.lastError = lastError;
    }
    incrementAttempt(id) {
        const f = this.files.get(id);
        if (!f)
            return 0;
        f.attempt += 1;
        return f.attempt;
    }
    recordSpeedSample(id, bytes, t = Date.now()) {
        const f = this.files.get(id);
        if (!f)
            return;
        f.speedSamples.push({ t, bytes });
        // Keep only the last 30 samples (~3 seconds at 10 Hz).
        if (f.speedSamples.length > 30)
            f.speedSamples.shift();
    }
    /** Compute a rolling bytes-per-second for one file. */
    speedFor(id) {
        const f = this.files.get(id);
        if (!f || f.speedSamples.length < 2)
            return 0;
        const first = f.speedSamples[0];
        const last = f.speedSamples[f.speedSamples.length - 1];
        const dt = (last.t - first.t) / 1000;
        if (dt <= 0)
            return 0;
        return Math.max(0, (last.bytes - first.bytes) / dt);
    }
    /** Produce a snapshot suitable for the UI. */
    snapshot(id) {
        const f = this.files.get(id);
        if (!f)
            return null;
        return {
            id: f.id,
            name: f.source.name ?? f.source.relativePath.split("/").pop() ?? "file",
            relativePath: f.source.relativePath,
            size: f.source.size,
            bytesUploaded: f.bytesUploaded,
            state: f.state,
            pool: f.pool,
            attempt: f.attempt,
            errorMessage: f.errorMessage,
            speedBps: this.speedFor(f.id),
            startedAt: f.startedAt,
            completedAt: f.completedAt,
            driveFileId: f.driveFileId,
        };
    }
    /** Remove all completed/canceled entries to free memory. */
    pruneFinished() {
        let removed = 0;
        for (const [id, f] of this.files) {
            if (f.state === "completed" || f.state === "canceled") {
                this.files.delete(id);
                this.order = this.order.filter((x) => x !== id);
                removed++;
            }
        }
        return removed;
    }
}
//# sourceMappingURL=QueueManager.js.map