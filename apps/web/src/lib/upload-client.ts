"use client";

/**
 * Bridges the upload engine to the Pagaska backend.
 *
 * The engine wants a "Google Drive adapter" that knows how to:
 *   1. open a resumable session
 *   2. upload a chunk
 *   3. query progress
 *
 * Rather than talk to Google directly, we forward every operation
 * to the Cloudflare Worker, which holds the Google OAuth token.
 *
 * IMPORTANT — RESPONSE CONTRACT (B#5):
 *   The browser only ever speaks to the Worker. The Worker parses
 *   Google's responses and returns its own JSON envelope:
 *     200/201 → { acknowledged: <bytesUploaded>, finished: true,  driveFileId: <id|null> }
 *     308     → { acknowledged: <bytesUploaded>, finished: false, driveFileId: null }
 *   We read the JSON body for BOTH cases. We do NOT parse Google's
 *   `Range` header on the browser side; the worker has already
 *   extracted the offset. The previous version of this file read
 *   `Range` from the worker's response, which happened to work only
 *   because the worker also forwarded the header — it was redundant
 *   and would silently break if the worker ever changed its envelope.
 *
 * IMPORTANT — SESSION OFFSET (B#3):
 *   The browser must NOT call Google's session URI directly. The
 *   session URI is bound to the Worker's network context and is not
 *   reachable from a browser (CORS). For resume, we trust the
 *   locally-persisted `bytesUploaded` from the engine's session
 *   storage and let the next chunk PUT re-sync if Google has more
 *   or fewer bytes than we think.
 *
 * IMPORTANT — PARENT FOLDER (B#6):
 *   The `parentId` argument is forwarded to the Worker as-is. The
 *   engine constructs the adapter with `engine.config.parentFolderId`,
 *   so the user's selected folder is propagated all the way through.
 */

import { api } from "./api";
import type {
  ResumableSession,
  UploadSource,
} from "@pagaska/upload-engine";
import { UploadError, isRecoverableStatus } from "@pagaska/upload-engine";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8787";

function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? window.localStorage.getItem("pagaska.token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface OpenSessionArgs {
  source: UploadSource;
  parentId: string | null;
}

export interface OpenSessionResult extends ResumableSession {
  driveFileId: string | null;
}

export async function openSession({ source, parentId }: OpenSessionArgs): Promise<OpenSessionResult> {
  const filename = source.name ?? source.relativePath.split("/").pop() ?? "untitled";
  const mimeType = source.mimeType ?? "application/octet-stream";
  // Forward the user-selected parentId to the worker (B#6). The
  // worker will use it for the resumable session metadata, and
  // fall back to the workspace's root if `parentId` is null.
  const { sessionUri, totalBytes } = await api.startUpload({
    filename,
    mimeType,
    size: source.size,
    parentId,
  });
  return {
    sessionUri,
    bytesUploaded: 0,
    totalBytes,
    parentId,
    filename,
    mimeType,
    openedAt: Date.now(),
    driveFileId: null,
  };
}

export interface UploadChunkArgs {
  session: ResumableSession;
  chunk: { start: number; end: number; bytes: Uint8Array };
  expectedStart: number;
}

export interface UploadChunkResult {
  acknowledged: number;
  driveFileId: string | null;
  finished: boolean;
}

export async function uploadChunk({ session, chunk, expectedStart }: UploadChunkArgs): Promise<UploadChunkResult> {
  if (expectedStart !== session.bytesUploaded) {
    throw new UploadError("Client/server offset mismatch", { recoverable: true, status: 409 });
  }
  // The engine reads the chunk as a Uint8Array; copy into a plain
  // ArrayBuffer to satisfy strict DOM lib BodyInit typings.
  const ab = new ArrayBuffer(chunk.bytes.byteLength);
  new Uint8Array(ab).set(chunk.bytes);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/upload/chunk`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": session.mimeType,
        "X-Session-Uri": session.sessionUri,
        "X-Upload-Start": String(chunk.start),
        "X-Upload-End": String(chunk.end),
        "X-Upload-Total": String(session.totalBytes),
      },
      body: ab,
    });
  } catch (err) {
    // Network-level failure (DNS, offline, CORS, etc.) — B#7: surface
    // the actual error message and a 0 status so the UI can render it.
    const message = err instanceof Error ? err.message : "Network error during chunk upload.";
    throw new UploadError(`network: ${message}`, {
      recoverable: true,
      status: 0,
      cause: err,
    });
  }

  // Read the JSON body for BOTH the intermediate (308) and final
  // (200/201) success paths. The worker emits the same envelope in
  // both cases (B#5).
  if (res.status === 308 || res.status === 200 || res.status === 201) {
    let payload: { acknowledged: number; finished: boolean; driveFileId: string | null };
    try {
      payload = (await res.json()) as typeof payload;
    } catch {
      // Defensive: a malformed 2xx body should not silently succeed.
      throw new UploadError(
        `Worker returned ${res.status} with non-JSON body for chunk ${chunk.start}-${chunk.end}`,
        { recoverable: true, status: res.status }
      );
    }
    return {
      acknowledged: typeof payload.acknowledged === "number" ? payload.acknowledged : chunk.end,
      driveFileId: payload.driveFileId ?? null,
      finished: Boolean(payload.finished),
    };
  }

  // Non-success. Try to parse the worker's structured error envelope
  // (B#7) so the UI gets the real message + status.
  let code = "INTERNAL_ERROR";
  let message = `HTTP ${res.status}`;
  let workerStatus: number | null = res.status;
  try {
    const data = (await res.json()) as { success?: false; code?: string; message?: string; status?: number };
    if (data?.code) code = data.code;
    if (data?.message) message = data.message;
    if (typeof data?.status === "number") workerStatus = data.status;
  } catch {
    try {
      const text = await res.text();
      if (text) message = text.slice(0, 256);
    } catch {
      /* body unreadable */
    }
  }
  throw new UploadError(`chunk upload failed (${code}): ${message}`, {
    recoverable: isRecoverableStatus(workerStatus),
    status: workerStatus,
  });
}

/**
 * Resume progress query.
 *
 * The previous implementation PUTed directly to the Google session
 * URI from the browser. This is wrong on two axes:
 *   1. CORS — Google does not allow cross-origin PUTs to session URIs.
 *   2. Architecture — the browser is supposed to talk ONLY to the
 *      Worker, per the design brief.
 *
 * The engine's `ensureSession` calls this when a persisted session
 * is found. We no longer make a network call here; we trust the
 * locally-persisted `bytesUploaded` and let the next chunk PUT
 * confirm with Google via 308 + Range. If the persisted offset is
 * stale, Google's response to the next chunk will either be a 308
 * with a Range header (re-anchor us) or 200/201 (we're done).
 *
 * Returning the locally-cached value is a no-op as far as the
 * scheduler is concerned, which is exactly the desired behaviour:
 * resume uses local state, and the next chunk re-syncs if needed.
 */
export async function querySessionProgress(session: ResumableSession): Promise<number> {
  return session.bytesUploaded;
}
