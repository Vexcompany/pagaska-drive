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
 */

import { api } from "./api";
import type {
  ResumableSession,
  UploadError as _UE,
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

export async function querySessionProgress(session: ResumableSession): Promise<number> {
  // Drive's session-progress query uses a PUT with a "bytes */N" range.
  // We forward that exact call to the worker so the real token stays server-side.
  const res = await fetch(session.sessionUri, {
    method: "PUT",
    headers: {
      ...authHeaders(),
      "Content-Range": `bytes */${session.totalBytes}`,
    },
  });
  if (res.status === 200 || res.status === 201) return session.totalBytes;
  if (res.status === 308) {
    const range = res.headers.get("Range");
    if (!range) return 0;
    const m = /bytes=0-(\d+)/.exec(range);
    return m ? Number(m[1]) + 1 : 0;
  }
  const body = await res.text();
  throw new UploadError(`progress query failed: HTTP ${res.status} ${body.slice(0, 256)}`, {
    recoverable: isRecoverableStatus(res.status),
    status: res.status,
  });
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

  const res = await fetch(`${API_URL}/upload/chunk`, {
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

  if (res.status === 308) {
    const range = res.headers.get("Range");
    if (range) {
      const m = /bytes=0-(\d+)/.exec(range);
      if (m) return { acknowledged: Number(m[1]) + 1, driveFileId: null, finished: false };
    }
    return { acknowledged: chunk.end, driveFileId: null, finished: false };
  }
  if (res.status === 200 || res.status === 201) {
    const data = (await res.json()) as { acknowledged: number; finished: boolean; driveFileId: string | null };
    return data;
  }
  const body = await res.text();
  throw new UploadError(`chunk upload failed: HTTP ${res.status} ${body.slice(0, 256)}`, {
    recoverable: isRecoverableStatus(res.status),
    status: res.status,
  });
}
