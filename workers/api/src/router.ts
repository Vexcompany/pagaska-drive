import type { Env } from "./env";
import { signJwt, verifyJwt } from "./jwt";
import {
  listChildren,
  getFile,
  getBreadcrumb,
  deleteFile,
  trashFile,
  restoreFile,
  listTrashed,
  searchTrashed,
  renameFile,
  startResumableUpload,
  forwardChunk,
  ensureFolder,
  fetchMedia,
  ensurePublicPermission,
  listPermissions,
  searchDrive,
  moveFile,
  collectSubtree,
  HttpError,
} from "./google";
import { buildZip } from "./zip";
import { isWorkspace, WORKSPACES, type Workspace, type ApiErrorCode } from "@pagaska/shared";

/**
 * Maximum number of items the backend will process in a single
 * batch request.  Cloudflare Workers allow at most 50 subrequests
 * per invocation on the free plan.  Each batch item costs 2-3
 * subrequests (getFile + workspace check + operation), so 20
 * items keeps us safely under the limit even with shared-cached
 * parent walks.  The frontend splits larger batches into chunks
 * of this size and sends them sequentially.
 */
const MAX_BATCH = 20;

const CORS_HEADERS = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-pagaska-workspace, x-session-uri, x-upload-start, x-upload-end, x-upload-total",
  "Access-Control-Max-Age": "86400",
});

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function codeFor(err: HttpError): ApiErrorCode {
  switch (err.code) {
    case "INVALID_LOGIN_PAYLOAD": return "INVALID_LOGIN_PAYLOAD";
    case "INVALID_CREDENTIALS": return "INVALID_CREDENTIALS";
    case "UNAUTHENTICATED": return "UNAUTHENTICATED";
    case "FORBIDDEN": return "FORBIDDEN";
    case "INVALID_PAYLOAD": return "INVALID_PAYLOAD";
    case "MISSING_QUERY_PARAM": return "MISSING_QUERY_PARAM";
    case "DRIVE_ERROR": return "DRIVE_ERROR";
    case "MISSING_CONFIG": return "MISSING_CONFIG";
    case "CONFIG_ERROR": return "CONFIG_ERROR";
    case "ITEM_IN_TRASH": return "ITEM_IN_TRASH";
    case "INTERNAL_ERROR":
    default: return "INTERNAL_ERROR";
  }
}

function json(data: unknown, init: ResponseInit = {}, origin = "*"): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...CORS_HEADERS(origin), ...(init.headers ?? {}) },
  });
}

function err(code: ApiErrorCode, message: string, status: number, origin = "*"): Response {
  return json({ success: false, code, message, status }, { status }, origin);
}

function throwHttp(status: number, code: HttpError["code"], message: string): never {
  throw new HttpError(status, code, message);
}

async function requireAuth(request: Request, env: Env): Promise<Workspace> {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throwHttp(401, "UNAUTHENTICATED", "Missing bearer token.");
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) throwHttp(401, "UNAUTHENTICATED", "Invalid or expired token.");
  return payload.workspace;
}

function lookupWorkspacePassword(env: Env, workspace: Workspace): string | null {
  switch (workspace) {
    case "pagaska": return env.PAGASKA_PASSWORD || null;
    case "osama": return env.OSAMA_PASSWORD || null;
    case "pmr": return env.PMR_PASSWORD || null;
  }
}

async function getWorkspaceRootFolderId(env: Env, workspace: Workspace): Promise<string> {
  const rootId = env.GOOGLE_DRIVE_ROOT;
  if (!rootId) throwHttp(500, "MISSING_CONFIG", "GOOGLE_DRIVE_ROOT is not configured.");
  const folder = await ensureFolder(env, rootId, workspace);
  return folder.id;
}

function toClientFile(f: { id: string; name: string; mimeType: string; size: string | null; parents: string[]; thumbnailLink: string | null; webViewLink: string | null; modifiedTime: string | null; trashed: boolean }) {
  return {
    id: f.id, name: f.name, mimeType: f.mimeType,
    size: f.size ? Number(f.size) : null,
    parents: f.parents, thumbnailLink: f.thumbnailLink,
    webViewLink: f.webViewLink, modifiedTime: f.modifiedTime,
    trashed: f.trashed,
  };
}

/** Validate that fileIds is a non-empty array of strings within MAX_BATCH. */
function validateBatchIds(body: unknown): string[] {
  if (!body || !Array.isArray((body as { fileIds?: unknown }).fileIds) ||
      ((body as { fileIds: unknown[] }).fileIds).length === 0 ||
      !((body as { fileIds: unknown[] }).fileIds).every((id) => typeof id === "string")) {
    throwHttp(400, "INVALID_PAYLOAD", "fileIds must be a non-empty array of strings.");
  }
  const ids = (body as { fileIds: string[] }).fileIds;
  if (ids.length > MAX_BATCH) {
    throwHttp(400, "INVALID_PAYLOAD", `Batch too large: ${ids.length} items. Maximum is ${MAX_BATCH} per request. Split into smaller batches on the client.`);
  }
  return ids;
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const origin = env.CORS_ORIGIN ?? "*";
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS(origin) });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");

  try {
    // ------- AUTH -------
    if (path === "/auth/login" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as { workspace?: unknown; password?: unknown } | null;
      if (!body || !isWorkspace(body.workspace) || typeof body.password !== "string" || body.password.length === 0) {
        return err("INVALID_LOGIN_PAYLOAD", "Provide a workspace and a non-empty password.", 400, origin);
      }
      const workspace = body.workspace;
      const expected = lookupWorkspacePassword(env, workspace);
      if (!expected) return err("CONFIG_ERROR", `No password configured for workspace "${workspace}".`, 500, origin);
      const ok = await constantTimeEqual(body.password, expected);
      if (!ok) return err("INVALID_CREDENTIALS", "Wrong password for the selected workspace.", 401, origin);
      const token = await signJwt({ sub: workspace, workspace }, 60 * 60 * 24 * 7, env.JWT_SECRET);
      return json({ token, workspace, issuedAt: Math.floor(Date.now() / 1000), expiresAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 }, {}, origin);
    }

    if (path === "/auth/workspaces" && request.method === "GET") {
      return json({ workspaces: [...WORKSPACES] }, {}, origin);
    }

    if (path === "/auth/profile" && request.method === "GET") {
      const workspace = await requireAuth(request, env);
      return json({ workspace }, {}, origin);
    }

    // ------- BROWSE -------
    if (path === "/files" && request.method === "GET") {
      const workspace = await requireAuth(request, env);
      const folderParam = url.searchParams.get("folder");
      const folderId = folderParam || (await getWorkspaceRootFolderId(env, workspace));
      const items = await listChildren(env, folderId);
      const folders = items.filter((f) => f.mimeType === "application/vnd.google-apps.folder");
      const files = items.filter((f) => f.mimeType !== "application/vnd.google-apps.folder");
      const folder = folderParam ? await getFile(env, folderId) : null;
      const breadcrumb = await getBreadcrumb(env, folderId, env.GOOGLE_DRIVE_ROOT);
      return json({ folder: folder ? toClientFile(folder) : null, files: files.map(toClientFile), folders: folders.map(toClientFile), breadcrumb }, {}, origin);
    }

    if (path === "/folders" && request.method === "POST") {
      const workspace = await requireAuth(request, env);
      const body = (await request.json().catch(() => null)) as { name?: unknown; parentId?: unknown } | null;
      if (!body || typeof body.name !== "string" || !body.name.trim()) {
        return err("INVALID_PAYLOAD", "Folder name is required.", 400, origin);
      }
      const parentId = (body.parentId as string | null) || (await getWorkspaceRootFolderId(env, workspace));
      const created = await ensureFolder(env, parentId, body.name.trim());
      return json({ folder: toClientFile(created) }, {}, origin);
    }

    // ------- MUTATE: DELETE moves to Trash -------
    const deleteMatch = /^\/files\/([^/]+)$/.exec(path);
    if (deleteMatch && request.method === "DELETE") {
      const workspace = await requireAuth(request, env);
      const fileId = deleteMatch[1];
      const file = await getFile(env, fileId);
      if (!isInsideRoot(file, env.GOOGLE_DRIVE_ROOT, workspace, env)) {
        return err("FORBIDDEN", "File is outside the workspace root.", 403, origin);
      }
      await trashFile(env, fileId);
      return json({ ok: true }, {}, origin);
    }

    if (path === "/rename" && request.method === "PATCH") {
      await requireAuth(request, env);
      const body = (await request.json().catch(() => null)) as { fileId?: unknown; name?: unknown } | null;
      if (!body || typeof body.fileId !== "string" || typeof body.name !== "string") {
        return err("INVALID_PAYLOAD", "Both fileId and name are required.", 400, origin);
      }
      const file = await renameFile(env, body.fileId, body.name);
      return json({ file: toClientFile(file) }, {}, origin);
    }

    // ------- TRASH -------
    // GET /trash — list top-level trashed items in the workspace
    //
    // When a folder is trashed in Google Drive, the folder AND all its
    // descendants are marked trashed.  If we return every trashed item,
    // the Trash UI shows a flattened list where children appear as
    // separate items alongside their parent folder.  This breaks:
    //   1. The Trash UI — children should be inside the folder, not at top level
    //   2. Permanent Delete — deleting the folder already deletes children,
    //      so subsequent delete calls on children fail with "item not found"
    //   3. Restore — restoring children individually may fail or put them
    //      in the wrong location
    //
    // FIX: Only return items whose parent is NOT trashed.  This means:
    //   - A trashed folder whose parent is the workspace root → shown
    //   - A trashed file inside a trashed folder → hidden (it's inside the folder)
    //   - A trashed file whose parent folder is NOT trashed → shown
    //
    // The check is: for each trashed item, look up its parent.  If the
    // parent is also trashed, skip the item — it's a descendant of a
    // trashed folder and will be shown/restored/deleted with the folder.
    if (path === "/trash" && request.method === "GET") {
      const workspace = await requireAuth(request, env);
      const rootFolderId = await getWorkspaceRootFolderId(env, workspace);
      const allTrashed = await listTrashed(env);
      // Filter to items within the workspace root using a shared cache.
      // Cap at a safe limit to stay under the Cloudflare subrequest ceiling.
      const cache = new Map<string, Awaited<ReturnType<typeof getFile>>>();
      const scoped: typeof allTrashed = [];
      const limit = Math.min(allTrashed.length, MAX_BATCH * 2);
      for (let i = 0; i < limit; i++) {
        const item = allTrashed[i];
        const inside = await isInsideRoot(item, env.GOOGLE_DRIVE_ROOT, workspace, env, cache);
        if (!inside) continue;
        // Check if the item's parent is also trashed.  If so, the item
        // is a descendant of a trashed folder and should be hidden —
        // it will be shown/restored/deleted with the folder.
        const parentId = item.parents?.[0];
        if (parentId) {
          let parent: Awaited<ReturnType<typeof getFile>> | undefined = cache.get(parentId);
          if (!parent) {
            try {
              parent = await getFile(env, parentId);
              cache.set(parentId, parent);
            } catch {
              // Parent might be already deleted — treat as top-level
              parent = undefined;
            }
          }
          if (parent && parent.trashed) {
            // Parent is trashed → this item is inside a trashed folder → skip
            continue;
          }
        }
        scoped.push(item);
      }
      const folders = scoped.filter((f) => f.mimeType === "application/vnd.google-apps.folder");
      const files = scoped.filter((f) => f.mimeType !== "application/vnd.google-apps.folder");
      return json({ files: files.map(toClientFile), folders: folders.map(toClientFile), breadcrumb: [], hasMore: allTrashed.length > limit }, {}, origin);
    }

    // POST /trash — move items to trash (batch, max MAX_BATCH)
    if (path === "/trash" && request.method === "POST") {
      const workspace = await requireAuth(request, env);
      const body = (await request.json().catch(() => null));
      const fileIds = validateBatchIds(body);
      const cache = new Map<string, Awaited<ReturnType<typeof getFile>>>();
      let trashed = 0;
      const failed: string[] = [];
      for (const fileId of fileIds) {
        try {
          const file = await getFile(env, fileId);
          if (!isInsideRoot(file, env.GOOGLE_DRIVE_ROOT, workspace, env, cache)) { failed.push(fileId); continue; }
          await trashFile(env, fileId);
          trashed += 1;
        } catch { failed.push(fileId); }
      }
      return json({ ok: true, trashed, failed }, {}, origin);
    }

    // POST /trash/restore — restore items from trash (batch, max MAX_BATCH)
    // For trashed items, skip the expensive isInsideRoot walk and just
    // verify the file is actually trashed.  Items were scoped to the
    // workspace when they were listed via GET /trash.
    //
    // IMPORTANT: When a folder is restored, Google Drive automatically
    // restores all its descendants.  If the batch contains both a folder
    // and its children, the children may already be un-trashed by the
    // time we try to restore them.  Treat already-untrashed items as
    // success (they were restored as part of the folder cascade).
    if (path === "/trash/restore" && request.method === "POST") {
      const workspace = await requireAuth(request, env);
      const body = (await request.json().catch(() => null));
      const fileIds = validateBatchIds(body);
      // Restore folders first so children are auto-restored
      const folderIds: string[] = [];
      const nonFolderIds: string[] = [];
      const fileCache = new Map<string, Awaited<ReturnType<typeof getFile>>>();
      for (const fileId of fileIds) {
        try {
          const file = await getFile(env, fileId);
          fileCache.set(fileId, file);
          if (file.mimeType === "application/vnd.google-apps.folder") {
            folderIds.push(fileId);
          } else {
            nonFolderIds.push(fileId);
          }
        } catch { /* will be caught below */ }
      }
      let restored = 0;
      const failed: string[] = [];
      // Restore folders first — they cascade-restore children
      for (const fileId of folderIds) {
        try {
          const file = fileCache.get(fileId);
          if (!file) { failed.push(fileId); continue; }
          if (!file.trashed) { restored += 1; continue; } // already restored
          await restoreFile(env, fileId);
          restored += 1;
        } catch { failed.push(fileId); }
      }
      // Restore non-folder items — may already be restored via folder cascade
      for (const fileId of nonFolderIds) {
        try {
          const file = fileCache.get(fileId);
          if (!file) { failed.push(fileId); continue; }
          if (!file.trashed) { restored += 1; continue; } // already restored (cascade)
          await restoreFile(env, fileId);
          restored += 1;
        } catch { failed.push(fileId); }
      }
      return json({ ok: true, restored, failed }, {}, origin);
    }

    // DELETE /trash — permanently delete items (batch, max MAX_BATCH)
    // For trashed items, skip the expensive isInsideRoot walk and just
    // verify the file is actually trashed.  This keeps each item at 2
    // subrequests (getFile + deleteFile) instead of 4-7.
    //
    // IMPORTANT: When a folder is deleted, Google Drive automatically
    // deletes all its descendants.  If the batch contains both a folder
    // and its children, the children will fail because they were already
    // deleted when the folder was deleted.  To prevent this, we:
    //   1. First pass: collect all folder IDs and delete them
    //   2. Second pass: try to delete remaining items, treating 404 as
    //      success (already deleted as part of a folder)
    if (path === "/trash" && request.method === "DELETE") {
      const workspace = await requireAuth(request, env);
      const body = (await request.json().catch(() => null));
      const fileIds = validateBatchIds(body);
      let deleted = 0;
      const failed: string[] = [];
      // Phase 1: delete folders first (they cascade-delete children)
      const folderIds: string[] = [];
      const nonFolderIds: string[] = [];
      const fileCache = new Map<string, Awaited<ReturnType<typeof getFile>>>();
      for (const fileId of fileIds) {
        try {
          const file = await getFile(env, fileId);
          fileCache.set(fileId, file);
          if (!file.trashed) { failed.push(fileId); continue; }
          if (file.mimeType === "application/vnd.google-apps.folder") {
            folderIds.push(fileId);
          } else {
            nonFolderIds.push(fileId);
          }
        } catch { failed.push(fileId); }
      }
      // Delete folders first — each one cascades to its children
      for (const fileId of folderIds) {
        try {
          await deleteFile(env, fileId);
          deleted += 1;
        } catch { failed.push(fileId); }
      }
      // Delete non-folder items — if a 404 is returned, the item was
      // already deleted as part of a folder's cascade.  Count as success.
      for (const fileId of nonFolderIds) {
        try {
          const file = fileCache.get(fileId);
          if (file && !file.trashed) { failed.push(fileId); continue; }
          await deleteFile(env, fileId);
          deleted += 1;
        } catch (e) {
          // If the error is a 404, the file was already deleted as part
          // of a folder cascade — count as success, not failure.
          if (e instanceof HttpError && e.status === 404) {
            deleted += 1;
          } else {
            failed.push(fileId);
          }
        }
      }
      return json({ ok: true, deleted, failed }, {}, origin);
    }

    // GET /trash/search — search within trashed items
    if (path === "/trash/search" && request.method === "GET") {
      const workspace = await requireAuth(request, env);
      const query = (url.searchParams.get("q") ?? "").trim();
      if (!query) return json({ files: [], folders: [] }, {}, origin);
      const results = await searchTrashed(env, query);
      const cache = new Map<string, Awaited<ReturnType<typeof getFile>>>();
      const files: { id: string; name: string; mimeType: string; size: number | null; parents: string[]; thumbnailLink: string | null; webViewLink: string | null; modifiedTime: string | null; trashed: boolean; path: string | null }[] = [];
      const folders: typeof files = [];
      const limit = Math.min(results.length, MAX_BATCH * 2);
      for (let i = 0; i < limit; i++) {
        const item = results[i];
        const inside = await isInsideRoot(item, env.GOOGLE_DRIVE_ROOT, workspace, env, cache);
        if (!inside) continue;
        const resolvedPath = await scopedSearchPath(env, item, env.GOOGLE_DRIVE_ROOT, workspace, cache);
        if (resolvedPath === undefined) continue;
        const entry = { ...toClientFile(item), path: resolvedPath === null ? null : resolvedPath };
        if (item.mimeType === "application/vnd.google-apps.folder") folders.push(entry);
        else files.push(entry);
      }
      return json({ files, folders }, {}, origin);
    }

    // ------- UPLOAD HELPERS -------
    if (path === "/upload/start" && request.method === "POST") {
      const workspace = await requireAuth(request, env);
      const body = (await request.json().catch(() => null)) as { filename?: unknown; mimeType?: unknown; size?: unknown; parentId?: unknown } | null;
      if (!body || typeof body.filename !== "string" || typeof body.mimeType !== "string" || typeof body.size !== "number") {
        return err("INVALID_PAYLOAD", "filename, mimeType and size are required.", 400, origin);
      }
      const parentId = (body.parentId as string | null) || (await getWorkspaceRootFolderId(env, workspace));
      const result = await startResumableUpload(env, { filename: body.filename, mimeType: body.mimeType, size: body.size, parentId });
      return json(result, {}, origin);
    }

    if (path === "/upload/chunk" && request.method === "POST") {
      await requireAuth(request, env);
      const headers = request.headers;
      const start = Number(headers.get("x-upload-start"));
      const end = Number(headers.get("x-upload-end"));
      const total = Number(headers.get("x-upload-total"));
      const sessionUri = headers.get("x-session-uri") || "";
      const mimeType = headers.get("content-type") || "application/octet-stream";
      if (!sessionUri || !Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(total)) {
        return err("INVALID_PAYLOAD", "x-session-uri, x-upload-start, x-upload-end and x-upload-total are required.", 400, origin);
      }
      const body = await request.arrayBuffer();
      const result = await forwardChunk(env, { sessionUri, start, end, total, mimeType, body });
      return json(result, {}, origin);
    }

    if (path === "/upload/finish" && request.method === "POST") {
      const workspace = await requireAuth(request, env);
      const body = (await request.json().catch(() => null)) as { fileId?: unknown } | null;
      if (!body || typeof body.fileId !== "string") {
        return err("INVALID_PAYLOAD", "fileId is required.", 400, origin);
      }
      const file = await getFile(env, body.fileId);
      if (!isInsideRoot(file, env.GOOGLE_DRIVE_ROOT, workspace, env)) {
        return err("FORBIDDEN", "File is outside the workspace root.", 403, origin);
      }
      return json({ ok: true, file: toClientFile(file) }, {}, origin);
    }

    // ------- PREVIEW -------
    if (path === "/preview" && request.method === "GET") {
      await requireAuth(request, env);
      const fileId = url.searchParams.get("id");
      if (!fileId) return err("MISSING_QUERY_PARAM", "Query parameter 'id' is required.", 400, origin);
      const file = await getFile(env, fileId);
      const thumbnailUrl = file.thumbnailLink && typeof file.thumbnailLink === "string" ? file.thumbnailLink.replace(/=s\d+/, "=s1024") : null;
      const baseOrigin = new URL(request.url).origin;
      const contentUrl = `${baseOrigin}/media?id=${encodeURIComponent(fileId)}`;
      return json({ id: file.id, name: file.name, mimeType: file.mimeType, size: file.size ? Number(file.size) : null, thumbnailUrl, contentUrl, webViewLink: file.webViewLink, trashed: file.trashed }, {}, origin);
    }

    // ------- MEDIA (proxied file content) -------
    if (path === "/media" && request.method === "GET") {
      await requireAuth(request, env);
      const fileId = url.searchParams.get("id");
      if (!fileId) return err("MISSING_QUERY_PARAM", "Query parameter 'id' is required.", 400, origin);
      const file = await getFile(env, fileId);
      const range = request.headers.get("range");
      const media = await fetchMedia(env, fileId, range);
      const headers = new Headers(CORS_HEADERS(origin));
      headers.set("Content-Type", file.mimeType);
      for (const name of ["content-range", "accept-ranges", "content-length", "etag", "last-modified"]) {
        const value = media.headers.get(name);
        if (value) headers.set(name, value);
      }
      return new Response(media.body, { status: media.status, headers });
    }

    // ------- SEARCH (recursive, excludes trash) -------
    if (path === "/search" && request.method === "GET") {
      const workspace = await requireAuth(request, env);
      const query = (url.searchParams.get("q") ?? "").trim();
      if (!query) return json({ files: [], folders: [] }, {}, origin);
      const results = await searchDrive(env, query);
      const cache = new Map<string, Awaited<ReturnType<typeof getFile>>>();
      const files: { id: string; name: string; mimeType: string; size: number | null; parents: string[]; thumbnailLink: string | null; webViewLink: string | null; modifiedTime: string | null; trashed: boolean; path: string | null }[] = [];
      const folders: typeof files = [];
      for (const item of results) {
        const pathStr = await scopedSearchPath(env, item, env.GOOGLE_DRIVE_ROOT, workspace, cache);
        if (pathStr === undefined) continue;
        const entry = { ...toClientFile(item), path: pathStr === null ? null : pathStr };
        if (item.mimeType === "application/vnd.google-apps.folder") folders.push(entry);
        else files.push(entry);
      }
      return json({ files, folders }, {}, origin);
    }

    // ------- SHARE -------
    if (path === "/share" && request.method === "GET") {
      const workspace = await requireAuth(request, env);
      const fileId = url.searchParams.get("id");
      if (!fileId) return err("MISSING_QUERY_PARAM", "Query parameter 'id' is required.", 400, origin);
      const file = await getFile(env, fileId);
      if (!isInsideRoot(file, env.GOOGLE_DRIVE_ROOT, workspace, env)) return err("FORBIDDEN", "File is outside the workspace root.", 403, origin);
      if (file.trashed) return err("ITEM_IN_TRASH", "Cannot share an item that is in Trash.", 400, origin);
      const permissions = await listPermissions(env, fileId);
      const publicPerm = permissions.find((p) => p.type === "anyone" && p.role === "reader");
      return json({ public: Boolean(publicPerm), role: publicPerm?.role ?? null, webViewLink: file.webViewLink ?? null }, {}, origin);
    }

    if (path === "/share" && request.method === "POST") {
      const workspace = await requireAuth(request, env);
      const body = (await request.json().catch(() => null)) as { fileId?: unknown } | null;
      if (!body || typeof body.fileId !== "string" || !body.fileId.trim()) {
        return err("INVALID_PAYLOAD", "fileId is required.", 400, origin);
      }
      const file = await getFile(env, body.fileId);
      if (!isInsideRoot(file, env.GOOGLE_DRIVE_ROOT, workspace, env)) return err("FORBIDDEN", "File is outside the workspace root.", 403, origin);
      if (file.trashed) return err("ITEM_IN_TRASH", "Cannot share an item that is in Trash.", 400, origin);
      const shared = await ensurePublicPermission(env, body.fileId);
      return json({ webViewLink: shared.webViewLink }, {}, origin);
    }

    // ------- MOVE -------
    if (path === "/move" && request.method === "POST") {
      const workspace = await requireAuth(request, env);
      const body = (await request.json().catch(() => null)) as { fileIds?: unknown; parentId?: unknown } | null;
      if (!body || !Array.isArray(body.fileIds) || body.fileIds.length === 0 || !body.fileIds.every((id) => typeof id === "string")) {
        return err("INVALID_PAYLOAD", "fileIds must be a non-empty array of strings.", 400, origin);
      }
      const fileIds = body.fileIds as string[];
      if (fileIds.length > MAX_BATCH) {
        return err("INVALID_PAYLOAD", `Batch too large: ${fileIds.length} items. Maximum is ${MAX_BATCH} per request.`, 400, origin);
      }
      const parentId = body.parentId === null || body.parentId === undefined ? null : body.parentId;
      if (parentId !== null && typeof parentId !== "string") {
        return err("INVALID_PAYLOAD", "parentId must be a string or null.", 400, origin);
      }
      if (parentId) {
        const target = await getFile(env, parentId);
        if (target.mimeType !== "application/vnd.google-apps.folder") return err("INVALID_PAYLOAD", "Destination is not a folder.", 400, origin);
        if (!isInsideRoot(target, env.GOOGLE_DRIVE_ROOT, workspace, env)) return err("FORBIDDEN", "Destination is outside the workspace root.", 403, origin);
      }
      const cache = new Map<string, Awaited<ReturnType<typeof getFile>>>();
      let moved = 0;
      const failed: string[] = [];
      for (const fileId of fileIds) {
        try {
          const file = await getFile(env, fileId);
          if (!isInsideRoot(file, env.GOOGLE_DRIVE_ROOT, workspace, env, cache)) { failed.push(fileId); continue; }
          await moveFile(env, fileId, parentId ?? env.GOOGLE_DRIVE_ROOT);
          moved += 1;
        } catch { failed.push(fileId); }
      }
      return json({ ok: true, moved, failed }, {}, origin);
    }

    // ------- DOWNLOAD -------
    if (path === "/download" && request.method === "GET") {
      const workspace = await requireAuth(request, env);
      const fileId = url.searchParams.get("id");
      if (!fileId) return err("MISSING_QUERY_PARAM", "Query parameter 'id' is required.", 400, origin);
      const file = await getFile(env, fileId);
      if (!isInsideRoot(file, env.GOOGLE_DRIVE_ROOT, workspace, env)) return err("FORBIDDEN", "File is outside the workspace root.", 403, origin);
      const media = await fetchMedia(env, fileId);
      const headers = new Headers(CORS_HEADERS(origin));
      headers.set("Content-Type", file.mimeType);
      headers.set("Content-Disposition", `attachment; filename="${sanitizeFilename(file.name)}"`);
      const length = media.headers.get("content-length");
      if (length) headers.set("Content-Length", length);
      return new Response(media.body, { status: media.status, headers });
    }

    if (path === "/download/folder" && request.method === "GET") {
      const workspace = await requireAuth(request, env);
      const folderId = url.searchParams.get("id");
      if (!folderId) return err("MISSING_QUERY_PARAM", "Query parameter 'id' is required.", 400, origin);
      const folder = await getFile(env, folderId);
      if (!isInsideRoot(folder, env.GOOGLE_DRIVE_ROOT, workspace, env)) return err("FORBIDDEN", "Folder is outside the workspace root.", 403, origin);
      const subtree = await collectSubtree(env, folderId, folder.name);
      const entries = [{ path: `${folder.name}/`, data: new Uint8Array(0) }, ...subtree];
      const zip = buildZip(entries);
      const headers = new Headers(CORS_HEADERS(origin));
      headers.set("Content-Type", "application/zip");
      headers.set("Content-Disposition", `attachment; filename="${sanitizeFilename(folder.name)}.zip"`);
      headers.set("Content-Length", String(zip.byteLength));
      return new Response(zip, { status: 200, headers });
    }

    return err("NOT_FOUND", `Unknown route: ${request.method} ${path}`, 404, origin);
  } catch (e) {
    if (e instanceof HttpError) return err(codeFor(e), e.message, e.status, origin);
    const message = e instanceof Error ? e.message : "Unknown error";
    return err("INTERNAL_ERROR", message, 500, origin);
  }
}

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) {
    const hash = await crypto.subtle.digest("SHA-256", bb);
    void hash.byteLength;
    return false;
  }
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function sanitizeFilename(name: string): string {
  return name.replace(/["\r\n]/g, "_").replace(/\\/g, "_");
}

async function scopedSearchPath(
  env: Env, file: { parents?: string[] }, rootId: string, workspace: Workspace,
  cache: Map<string, Awaited<ReturnType<typeof getFile>>>
): Promise<string | null | undefined> {
  if (!file.parents || file.parents.length === 0) return undefined;
  if (file.parents.includes(rootId)) return undefined;
  const names: string[] = [];
  let current: string | undefined = file.parents[0];
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    let f = cache.get(current);
    if (!f) { f = await getFile(env, current); cache.set(current, f); }
    if (current === rootId) return names.join("/");
    if (f.name === workspace) return names.length ? names.join("/") : null;
    names.unshift(f.name);
    current = f.parents?.[0];
  }
  return undefined;
}

async function isInsideRoot(
  file: { id: string; parents?: string[] }, rootId: string, workspace: Workspace, env: Env,
  cache?: Map<string, Awaited<ReturnType<typeof getFile>>>
): Promise<boolean> {
  if (file.parents?.includes(rootId)) return true;
  let current: string | undefined = file.parents?.[0];
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current === rootId) return true;
    let f = cache?.get(current);
    if (!f) { f = await getFile(env, current); cache?.set(current, f); }
    if (f.name === workspace) return true;
    current = f.parents?.[0];
  }
  for (const id of seen) {
    let f = cache?.get(id);
    if (!f) { f = await getFile(env, id); cache?.set(id, f); }
    if (f.name === workspace) return true;
  }
  return false;
}
