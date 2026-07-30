"use client";

/**
 * Wires the @pagaska/upload-engine to the Pagaska Worker.
 *
 * The engine's `UploadEngine` is constructed with a default Google Drive
 * adapter, then we swap it out (via the public `setAdapter` method) for
 * a Worker-backed implementation defined in `./upload-client.ts`. This
 * keeps the engine's internals untouched — the only contact point is
 * the additive `setAdapter` method on the engine façade.
 */

import {
  UploadEngine,
  GoogleDriveAdapter,
  defaultConfig,
  type UploadSource,
  type ResumableSession,
} from "@pagaska/upload-engine";
import { openSession, querySessionProgress, uploadChunk } from "./upload-client";

// Make GoogleDriveAdapter's class constructor reachable as a value so
// `setAdapter` accepts our subclass.
declare module "@pagaska/upload-engine" {
  // Re-open to widen setAdapter's accepted type. The runtime check is
  // a structural duck-type — our subclass implements the same three
  // methods with compatible signatures.
  interface GoogleDriveAdapter {
    openSession(
      source: UploadSource,
      accessToken: string
    ): Promise<ResumableSession>;
    uploadChunk(
      session: ResumableSession,
      chunk: { start: number; end: number; bytes: Uint8Array },
      accessToken: string,
      expectedStart: number
    ): Promise<{ acknowledged: number; driveFileId: string | null; finished: boolean }>;
    queryProgress(
      session: ResumableSession,
      accessToken: string
    ): Promise<number>;
  }
}

export interface CreateEngineOptions {
  parentId: string | null;
  onProgress?: (snap: import("@pagaska/upload-engine").ProgressSnapshot) => void;
  onFileStateChange?: (file: import("@pagaska/upload-engine").UploadFileSnapshot) => void;
}

/**
 * A minimal adapter that satisfies the structural shape expected by the
 * engine. The methods are provided by `./upload-client.ts` and talk to
 * the Cloudflare Worker, which in turn talks to Google Drive.
 */
class WorkerBackedDriveAdapter {
  async openSession(source: UploadSource, _accessToken: string): Promise<ResumableSession> {
    // The Worker endpoint already knows which folder to upload into
    // because the engine's config has `parentFolderId` set. We pass
    // `null` for the parent here so the Worker's /upload/start handler
    // resolves the profile's root. The real parent selection happens
    // server-side based on the bearer token.
    const session = await openSession({ source, parentId: null });
    return session;
  }

  async uploadChunk(
    session: ResumableSession,
    chunk: { start: number; end: number; bytes: Uint8Array },
    _accessToken: string,
    expectedStart: number
  ): Promise<{ acknowledged: number; driveFileId: string | null; finished: boolean }> {
    return uploadChunk({ session, chunk, expectedStart });
  }

  async queryProgress(session: ResumableSession, _accessToken: string): Promise<number> {
    return querySessionProgress(session);
  }
}

export function createEngine(opts: CreateEngineOptions): UploadEngine {
  const engine = new UploadEngine({
    ...defaultConfig,
    chunkSize: 8 * 1024 * 1024,
    normalConcurrency: 4,
    retryConcurrency: 1,
    maxRetries: 5,
    backoffSeconds: [3, 8, 20, 45, 90],
    parentFolderId: opts.parentId,
    sessionPersistKey: `pagaska.sessions.${opts.parentId ?? "root"}`,
    getAccessToken: async () => "worker-bearer",
    onProgress: opts.onProgress,
    onFileStateChange: opts.onFileStateChange,
  });

  // Swap the engine's GoogleDriveAdapter for a Worker-backed one.
  // The engine exposes this single integration point.
  engine.setAdapter(new WorkerBackedDriveAdapter() as unknown as GoogleDriveAdapter);
  return engine;
}

export function toUploadSources(files: File[], rootPath: string = ""): UploadSource[] {
  return files.map((file) => {
    // For folder uploads, File.webkitRelativePath gives us the path
    // inside the dropped folder. For flat uploads, we use just the name.
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || `${rootPath}${file.name}`;
    return {
      file,
      relativePath: rel,
      name: file.name,
      size: file.size,
      mimeType: file.type || "application/octet-stream",
    } as UploadSource;
  });
}
