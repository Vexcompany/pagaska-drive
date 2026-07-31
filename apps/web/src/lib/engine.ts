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
import { api } from "./api";

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
 *
 * BUG #6 FIX: The previous version of this adapter passed
 * `parentId: null` to `openSession` regardless of the user-selected
 * folder. The comment claimed the Worker would resolve the workspace's
 * root, but the design brief is explicit: the engine must propagate
 * the selected parent. We now forward the engine's `parentFolderId`
 * (which is set from `opts.parentId` in `createEngine`) so the
 * worker's `/upload/start` request carries the real parent.
 */
/**
 * Maps a file's relative path to the Drive folder id it must be uploaded
 * into, creating the folder tree lazily (find-or-create per segment via
 * the Worker's /folders endpoint, which reuses existing folders). Paths
 * are cached so each directory is only resolved once per engine.
 *
 * Example: relativePath "Vacation/photo1.jpg" (from webkitRelativePath)
 * resolves "Vacation" under the base parent and returns its id, so the
 * file lands inside Vacation/ instead of flat in the base folder.
 */
class DriveFolderResolver {
  private readonly cache = new Map<string, Promise<string | null>>();

  constructor(private readonly getBaseParentId: () => string | null) {}

  /** Returns the Drive folder id that should contain `relativePath`. */
  parentFor(relativePath: string): Promise<string | null> {
    const parts = relativePath.split("/").filter(Boolean);
    parts.pop(); // drop the filename, keep the directory segments
    if (parts.length === 0) return Promise.resolve(this.getBaseParentId());
    const key = parts.join("/");
    let pending = this.cache.get(key);
    if (!pending) {
      pending = this.ensureParts(parts).catch((err) => {
        // Drop the cache entry on failure so a retry re-attempts creation.
        this.cache.delete(key);
        throw err;
      });
      this.cache.set(key, pending);
    }
    return pending;
  }

  private async ensureParts(parts: string[]): Promise<string | null> {
    let parentId = this.getBaseParentId();
    for (const name of parts) {
      // /folders uses ensureFolder: reuses an existing folder with the
      // same name, otherwise creates it. This keeps uploads idempotent
      // across repeated folder uploads.
      const { folder } = await api.createFolder({ name, parentId });
      parentId = folder.id;
    }
    return parentId;
  }
}

class WorkerBackedDriveAdapter {
  private readonly folders: DriveFolderResolver;

  constructor(getParentId: () => string | null) {
    this.folders = new DriveFolderResolver(getParentId);
  }

  async openSession(source: UploadSource, _accessToken: string): Promise<ResumableSession> {
    // Upload the file into its correct folder: for folder uploads the
    // relativePath carries the tree ("A/B/C/image.jpg"), so resolve the
    // leaf folder (creating missing folders) and forward that parent id.
    // Flat uploads have no path segments and use the base parent.
    const parentId = await this.folders.parentFor(source.relativePath ?? "");
    return openSession({ source, parentId });
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
    // Trust the locally-persisted offset. The Worker side returns the
    // authoritative number on the next chunk PUT (308 + Range), so
    // we don't need to make a separate progress query from the
    // browser. See upload-client.ts for details (B#3 fix).
    return querySessionProgress(session);
  }
}

export function createEngine(opts: CreateEngineOptions): UploadEngine {
  // The engine reads `parentFolderId` once at config-construction time
  // and threads it through every chunk via the adapter. We capture the
  // value in a closure so the adapter can read the latest selection
  // even if the engine is reconstructed (it isn't, but this is safer).
  const parentIdRef = { current: opts.parentId };
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
  // Must happen BEFORE any start() call. The engine exposes this
  // single integration point.
  engine.setAdapter(
    new WorkerBackedDriveAdapter(() => parentIdRef.current) as unknown as GoogleDriveAdapter
  );
  return engine;
}

/**
 * Update the parent folder of an existing engine instance. The upload
 * page can call this when the user navigates into a different folder
 * so the next `addFiles` batch uses the right parent.
 *
 * The engine itself does not have a setter for `parentFolderId`
 * (it's a config-time field), but the adapter closure above can be
 * updated to point at a new value. This is exposed as a separate
 * method so the call site is explicit.
 */
export function setEngineParent(engine: UploadEngine, parentId: string | null): void {
  // We cannot reach the closure from outside without exposing it,
  // but we can hot-swap the adapter with a new closure capturing
  // the new parent. The scheduler accepts a fresh adapter via
  // setAdapter on second call only if the engine allows it — by
  // design, the engine's setAdapter is one-shot. For simplicity
  // (and because the upload page reconstructs the engine on
  // folder change via the useEffect dependency on `folderId`),
  // we no-op here. Folder change creates a new engine; this
  // function is kept for future use and to make the intent clear.
  void engine;
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
