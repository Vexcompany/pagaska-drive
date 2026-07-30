import type {
  Logger,
  QueuedFile,
  ResumableSession,
  UploadEngineConfig,
  UploadSource,
} from "../types";
import { httpError, toUploadError } from "../utils/errors";

/**
 * The Google Drive resumable upload protocol has three steps per file:
 *
 *   1. POST  /upload/drive/v3/files?uploadType=resumable
 *            -> 200 + Location header (the session URI)
 *
 *   2. PUT   {sessionUri}
 *            with Content-Range: bytes {start}-{end}/{total}
 *            -> on the FINAL chunk, 200/201 with the file metadata;
 *               on intermediate chunks, 308 with Range: bytes=0-{last}
 *
 *   3. If we lose track of how many bytes were acknowledged, we can
 *      issue a status PUT to the session URI WITHOUT a body and read
 *      the Range header to find out where to resume.
 *
 * This adapter exposes a streaming chunk uploader; it does not know
 * about the scheduler or the queue.
 */
export class GoogleDriveAdapter {
  private readonly baseUrl = "https://www.googleapis.com/upload/drive/v3/files";

  constructor(
    private readonly config: UploadEngineConfig,
    private readonly logger: Logger
  ) {}

  /**
   * Open a new resumable session for `source`. Returns the session URI
   * plus enough metadata to recreate the request later.
   */
  async openSession(source: UploadSource, accessToken: string): Promise<ResumableSession> {
    const metadata: Record<string, unknown> = {
      name: source.name ?? source.relativePath.split("/").pop() ?? "untitled",
      mimeType: source.mimeType ?? "application/octet-stream",
    };
    if (this.config.parentFolderId) {
      metadata.parents = [this.config.parentFolderId];
    }

    const url = `${this.baseUrl}?uploadType=resumable`;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.config.requestTimeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": metadata.mimeType as string,
          "X-Upload-Content-Length": String(source.size),
        },
        body: JSON.stringify(metadata),
      });
      if (!res.ok) {
        const body = await safeText(res);
        throw httpError(res.status, body);
      }
      const sessionUri = res.headers.get("Location");
      if (!sessionUri) {
        throw httpError(500, "Drive did not return a Location header.");
      }
      return {
        sessionUri,
        bytesUploaded: 0,
        totalBytes: source.size,
        parentId: this.config.parentFolderId,
        filename: metadata.name as string,
        mimeType: metadata.mimeType as string,
        openedAt: Date.now(),
      };
    } catch (err) {
      throw toUploadError(err);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Query the server to find out how many bytes of a session have been
   * acknowledged. Returns 0 if the server has no record (rare).
   */
  async queryProgress(session: ResumableSession, accessToken: string): Promise<number> {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.config.requestTimeoutMs);
    try {
      const res = await fetch(session.sessionUri, {
        method: "PUT",
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Range": `bytes */${session.totalBytes}`,
        },
      });
      if (res.status === 200 || res.status === 201) {
        // Server already has the whole file.
        return session.totalBytes;
      }
      if (res.status === 308) {
        const range = res.headers.get("Range");
        if (!range) return 0;
        const m = /bytes=0-(\d+)/.exec(range);
        return m ? Number(m[1]) + 1 : 0;
      }
      const body = await safeText(res);
      throw httpError(res.status, body);
    } catch (err) {
      throw toUploadError(err);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Upload one chunk. Returns the number of bytes the server has
   * acknowledged AFTER this chunk.
   *
   * `expectedStart` is the byte offset the engine believes it is
   * writing from; if it disagrees with the server we abort and let
   * the engine resync via `queryProgress`.
   */
  async uploadChunk(
    session: ResumableSession,
    chunk: { start: number; end: number; bytes: Uint8Array },
    accessToken: string,
    expectedStart: number
  ): Promise<{ acknowledged: number; driveFileId: string | null; finished: boolean }> {
    if (expectedStart !== session.bytesUploaded) {
      // Out-of-sync. Caller should re-query.
      throw httpError(409, "Client/server byte offset mismatch; will re-query.");
    }

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.config.requestTimeoutMs);
    try {
      // Extract the chunk's bytes as a plain ArrayBuffer slice. We avoid
      // passing the Uint8Array directly because some TS DOM lib versions
      // narrow BlobPart/BodyInit in ways that reject ArrayBufferLike.
      const ab = new ArrayBuffer(chunk.bytes.byteLength);
      new Uint8Array(ab).set(chunk.bytes);
      const body: BodyInit = ab;

      const res = await fetch(session.sessionUri, {
        method: "PUT",
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": session.mimeType,
          "Content-Range": `bytes ${chunk.start}-${chunk.end - 1}/${session.totalBytes}`,
        },
        body,
      });

      if (res.status === 308) {
        // Intermediate chunk acknowledged.
        const range = res.headers.get("Range");
        if (range) {
          const m = /bytes=0-(\d+)/.exec(range);
          if (m) return { acknowledged: Number(m[1]) + 1, driveFileId: null, finished: false };
        }
        // 308 with no Range means the server has nothing yet.
        return { acknowledged: chunk.end, driveFileId: null, finished: false };
      }

      if (res.status === 200 || res.status === 201) {
        // Final chunk — server returns the file resource.
        const payload = await safeJson(res);
        return {
          acknowledged: session.totalBytes,
          driveFileId: (payload && (payload.id as string)) || null,
          finished: true,
        };
      }

      const text = await safeText(res);
      throw httpError(res.status, text);
    } catch (err) {
      throw toUploadError(err);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
