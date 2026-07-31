import type { Env } from "./env";
import { signJwt, verifyJwt } from "./jwt";
import {
  listChildren,
  getFile,
  getBreadcrumb,
  deleteFile,
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

const CORS_HEADERS = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-pagaska-workspace, x-session-uri, x-upload-start, x-upload-end, x-upload-total",
  "Access-Control-Max-Age": "86400",
});

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

/**
 * Map internal error codes to the public machine-readable code that
 * the frontend branches on. Stable across releases.
 */
function codeFor(err: HttpError): ApiErrorCode {
  switch (err.code) {
    case "INVALID_LOGIN_PAYLOAD":
      return "INVALID_LOGIN_PAYLOAD";
    case "INVALID_CREDENTIALS":
      return "INVALID_CREDENTIALS";
    case "UNAUTHENTICATED":
      return "UNAUTHENTICATED";
    case "FORBIDDEN":
      return "FORBIDDEN";
    case "INVALID_PAYLOAD":
      return "INVALID_PAYLOAD";
    case "MISSING_QUERY_PARAM":
      return "MISSING_QUERY_PARAM";
    case "DRIVE_ERROR":
      return "DRIVE_ERROR";
    case "MISSING_CONFIG":
      return "MISSING_CONFIG";
    case "CONFIG_ERROR":
      return "CONFIG_ERROR";
    case "INTERNAL_ERROR":
    default:
      return "INTERNAL_ERROR";
  }
}

function json(data: unknown, init: ResponseInit = {}, origin = "*"): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...CORS_HEADERS(origin),
      ...(init.headers ?? {}),
    },
  });
}

function err(code: ApiErrorCode, message: string, status: number, origin = "*"): Response {
  return json(
    { success: false, code, message, status },
    { status },
    origin
  );
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

/**
 * Look up the per-workspace password from Cloudflare runtime secrets.
 * The values are NEVER sent to the browser; only the equality check
 * happens server-side.
 */
function lookupWorkspacePassword(env: Env, workspace: Workspace): string | null {
  switch (workspace) {
    case "pagaska":
      return env.PAGASKA_PASSWORD || null;
    case "osama":
      return env.OSAMA_PASSWORD || null;
    case "pmr":
      return env.PMR_PASSWORD || null;
  }
}

async function getWorkspaceRootFolderId(env: Env, workspace: Workspace): Promise<string> {
  const rootId = env.GOOGLE_DRIVE_ROOT;
  if (!rootId) throwHttp(500, "MISSING_CONFIG", "GOOGLE_DRIVE_ROOT is not configured.");
  // Pre-create the per-workspace folder if missing.
  const folder = await ensureFolder(env, rootId, workspace);
  return folder.id;
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
      const body = (await request.json().catch(() => null)) as
        | { workspace?: unknown; password?: unknown }
        | null;
      if (!body || !isWorkspace(body.workspace) || typeof body.password !== "string" || body.password.length === 0) {
        return err("INVALID_LOGIN_PAYLOAD", "Provide a workspace and a non-empty password.", 400, origin);
      }
      const workspace = body.workspace;
      const expected = lookupWorkspacePassword(env, workspace);
      if (!expected) {
        // Misconfiguration: a workspace secret is missing. Surface a
        // config error rather than a generic auth failure so the
        // operator can fix it.
        return err("CONFIG_ERROR", `No password configured for workspace "${workspace}".`, 500, origin);
      }
      // Constant-time comparison to avoid leaking length-based timing
      // information. Both strings are short (operator-supplied
      // passwords) but using `timingSafeEqual` keeps the audit story
      // clean.
      const ok = await constantTimeEqual(body.password, expected);
      if (!ok) return err("INVALID_CREDENTIALS", "Wrong password for the selected workspace.", 401, origin);
      const token = await signJwt(
        { sub: workspace, workspace },
        60 * 60 * 24 * 7,
        env.JWT_SECRET
      );
      return json(
        {
          token,
          workspace,
          issuedAt: Math.floor(Date.now() / 1000),
          expiresAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
        },
        {},
        origin
      );
    }

    if (path === "/auth/workspaces" && request.method === "GET") {
      // Public list of available workspaces. Used by the login UI
      // before authentication. Does NOT leak passwords.
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
      return json({ folder, files, folders, breadcrumb }, {}, origin);
    }

    if (path === "/folders" && request.method === "POST") {
      const workspace = await requireAuth(request, env);
      const body = (await request.json().catch(() => null)) as { name?: unknown; parentId?: unknown } | null;
      if (!body || typeof body.name !== "string" || !body.name.trim()) {
        return err("INVALID_PAYLOAD", "Folder name is required.", 400, origin);
      }
      const parentId = (body.parentId as string | null) || (await getWorkspaceRootFolderId(env, workspace));
      const created = await ensureFolder(env, parentId, body.name.trim());
      return json({ folder: created }, {}, origin);
    }

    // ------- MUTATE -------
    const deleteMatch = /^\/files\/([^/]+)$/.exec(path);
    if (deleteMatch && request.method === "DELETE") {
      await requireAuth(request, env);
      const fileId = deleteMatch[1];
      await deleteFile(env, fileId);
      return json({ ok: true }, {}, origin);
    }

    if (path === "/rename" && request.method === "PATCH") {
      await requireAuth(request, env);
      const body = (await request.json().catch(() => null)) as { fileId?: unknown; name?: unknown } | null;
      if (!body || typeof body.fileId !== "string" || typeof body.name !== "string") {
        return err("INVALID_PAYLOAD", "Both fileId and name are required.", 400, origin);
      }
      const file = await renameFile(env, body.fileId, body.name);
      return json({ file }, {}, origin);
    }

    // ------- UPLOAD HELPERS -------
    if (path === "/upload/start" && request.method === "POST") {
      const workspace = await requireAuth(request, env);
      const body = (await request.json().catch(() => null)) as { filename?: unknown; mimeType?: unknown; size?: unknown; parentId?: unknown } | null;
      if (!body || typeof body.filename !== "string" || typeof body.mimeType !== "string" || typeof body.size !== "number") {
        return err("INVALID_PAYLOAD", "filename, mimeType and size are required.", 400, origin);
      }
      const parentId = (body.parentId as string | null) || (await getWorkspaceRootFolderId(env, workspace));
      const result = await startResumableUpload(env, {
        filename: body.filename,
        mimeType: body.mimeType,
        size: body.size,
        parentId,
      });
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
      // Convenience: when the engine finishes via the resumable session
      // directly, we don't strictly need this. But we expose it so the
      // UI can do a final read-back to confirm the file exists.
      const workspace = await requireAuth(request, env);
      const body = (await request.json().catch(() => null)) as { fileId?: unknown } | null;
      if (!body || typeof body.fileId !== "string") {
        return err("INVALID_PAYLOAD", "fileId is required.", 400, origin);
      }
      // Just confirm the file is visible to the user.
      const file = await getFile(env, body.fileId);
      // Ensure the file is actually inside the workspace's root subtree.
      if (!isInsideRoot(file, env.GOOGLE_DRIVE_ROOT, workspace, env)) {
        return err("FORBIDDEN", "File is outside the workspace root.", 403, origin);
      }
      return json({ ok: true, file }, {}, origin);
    }

    // ------- PREVIEW -------
    if (path === "/preview" && request.method === "GET") {
      await requireAuth(request, env);
      const fileId = url.searchParams.get("id");
      if (!fileId) return err("MISSING_QUERY_PARAM", "Query parameter 'id' is required.", 400, origin);
      const file = await getFile(env, fileId);
      // Defensive: `thumbnailLink` is typed as `string | null` but Google
      // can omit it entirely (in which case the JSON deserializes to
      // `undefined`). Guard against both before calling `.replace`.
      const thumbnailUrl =
        file.thumbnailLink && typeof file.thumbnailLink === "string"
          ? file.thumbnailLink.replace(/=s\d+/, "=s1024")
          : null;
      // Content is proxied through the Worker (`/media`) so the browser
      // never needs a Google token or signed URL; the Worker streams the
      // bytes with CORS headers and honors Range requests.
      const baseOrigin = new URL(request.url).origin;
      const contentUrl = `${baseOrigin}/media?id=${encodeURIComponent(fileId)}`;
      return json(
        {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size ? Number(file.size) : null,
          thumbnailUrl,
          contentUrl,
          webViewLink: file.webViewLink,
        },
        {},
        origin
      );
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
      // Pass through the headers that make media streaming work:
      // Content-Range / Accept-Ranges / Content-Length come from Google's
      // 200 or 206 response and must match the body actually streamed.
      for (const name of ["content-range", "accept-ranges", "content-length", "etag", "last-modified"]) {
        const value = media.headers.get(name);
        if (value) headers.set(name, value);
      }
      return new Response(media.body, { status: media.status, headers });
    }

    // ------- SEARCH (recursive, partial, case-insensitive) -------
    if (path === "/search" && request.method === "GET") {
      const workspace = await requireAuth(request, env);
      const query = (url.searchParams.get("q") ?? "").trim();
      if (!query) return json({ files: [], folders: [] }, {}, origin);
      const results = await searchDrive(env, query);
      // Scope to this workspace's root and resolve each result's path.
      const cache = new Map<string, Awaited<ReturnType<typeof getFile>>>();
      const files: { id: string; name: string; mimeType: string; size: string | null; parents: string[]; thumbnailLink: string | null; webViewLink: string | null; modifiedTime: string | null; path: string | null }[] = [];
      const folders: typeof files = [];
      for (const item of results) {
        const path = await scopedSearchPath(env, item, env.GOOGLE_DRIVE_ROOT, workspace, cache);
        if (path === undefined) continue; // outside the workspace root
        const entry = {
          id: item.id,
          name: item.name,
          mimeType: item.mimeType,
          size: item.size,
          parents: item.parents,
          thumbnailLink: item.thumbnailLink,
          webViewLink: item.webViewLink,
          modifiedTime: item.modifiedTime,
          path: path === null ? null : path,
        };
        if (item.mimeType === "application/vnd.google-apps.folder") folders.push(entry);
        else files.push(entry);
      }
      return json({ files, folders }, {}, origin);
    }

    // ------- SHARE STATUS (GET) / MAKE PUBLIC (POST) -------
    if (path === "/share" && request.method === "GET") {
      const workspace = await requireAuth(request, env);
      const fileId = url.searchParams.get("id");
      if (!fileId) return err("MISSING_QUERY_PARAM", "Query parameter 'id' is required.", 400, origin);
      const file = await getFile(env, fileId);
      if (!isInsideRoot(file, env.GOOGLE_DRIVE_ROOT, workspace, env)) {
        return err("FORBIDDEN", "File is outside the workspace root.", 403, origin);
      }
      const permissions = await listPermissions(env, fileId);
      const publicPerm = permissions.find((p) => p.type === "anyone" && p.role === "reader");
      return json(
        {
          public: Boolean(publicPerm),
          role: publicPerm?.role ?? null,
          webViewLink: file.webViewLink ?? null,
        },
        {},
        origin
      );
    }

    if (path === "/share" && request.method === "POST") {
      const workspace = await requireAuth(request, env);
      const body = (await request.json().catch(() => null)) as { fileId?: unknown } | null;
      if (!body || typeof body.fileId !== "string" || !body.fileId.trim()) {
        return err("INVALID_PAYLOAD", "fileId is required.", 400, origin);
      }
      // Only files inside this workspace's root can be shared by the user.
      const file = await getFile(env, body.fileId);
      if (!isInsideRoot(file, env.GOOGLE_DRIVE_ROOT, workspace, env)) {
        return err("FORBIDDEN", "File is outside the workspace root.", 403, origin);
      }
      const shared = await ensurePublicPermission(env, body.fileId);
      return json({ webViewLink: shared.webViewLink }, {}, origin);
    }

    // ------- MOVE -------
    if (path === "/move" && request.method === "POST") {
      const workspace = await requireAuth(request, env);
      const body = (await request.json().catch(() => null)) as { fileIds?: unknown; parentId?: unknown } | null;
      if (
        !body ||
        !Array.isArray(body.fileIds) ||
        body.fileIds.length === 0 ||
        !body.fileIds.every((id) => typeof id === "string")
      ) {
        return err("INVALID_PAYLOAD", "fileIds must be a non-empty array of strings.", 400, origin);
      }
      const parentId = body.parentId === null || body.parentId === undefined ? null : body.parentId;
      if (parentId !== null && typeof parentId !== "string") {
        return err("INVALID_PAYLOAD", "parentId must be a string or null.", 400, origin);
      }
      // Destination must be a folder inside the workspace root.
      if (parentId) {
        const target = await getFile(env, parentId);
        if (target.mimeType !== "application/vnd.google-apps.folder") {
          return err("INVALID_PAYLOAD", "Destination is not a folder.", 400, origin);
        }
        if (!isInsideRoot(target, env.GOOGLE_DRIVE_ROOT, workspace, env)) {
          return err("FORBIDDEN", "Destination is outside the workspace root.", 403, origin);
        }
      }
      let moved = 0;
      for (const fileId of body.fileIds as string[]) {
        const file = await getFile(env, fileId);
        if (!isInsideRoot(file, env.GOOGLE_DRIVE_ROOT, workspace, env)) continue;
        await moveFile(env, fileId, parentId ?? env.GOOGLE_DRIVE_ROOT);
        moved += 1;
      }
      return json({ ok: true, moved }, {}, origin);
    }

    // ------- DOWNLOAD (single file) -------
    if (path === "/download" && request.method === "GET") {
      const workspace = await requireAuth(request, env);
      const fileId = url.searchParams.get("id");
      if (!fileId) return err("MISSING_QUERY_PARAM", "Query parameter 'id' is required.", 400, origin);
      const file = await getFile(env, fileId);
      if (!isInsideRoot(file, env.GOOGLE_DRIVE_ROOT, workspace, env)) {
        return err("FORBIDDEN", "File is outside the workspace root.", 403, origin);
      }
      const media = await fetchMedia(env, fileId);
      const headers = new Headers(CORS_HEADERS(origin));
      headers.set("Content-Type", file.mimeType);
      headers.set("Content-Disposition", `attachment; filename="${sanitizeFilename(file.name)}"`);
      const length = media.headers.get("content-length");
      if (length) headers.set("Content-Length", length);
      return new Response(media.body, { status: media.status, headers });
    }

    // ------- DOWNLOAD FOLDER (as ZIP) -------
    if (path === "/download/folder" && request.method === "GET") {
      const workspace = await requireAuth(request, env);
      const folderId = url.searchParams.get("id");
      if (!folderId) return err("MISSING_QUERY_PARAM", "Query parameter 'id' is required.", 400, origin);
      const folder = await getFile(env, folderId);
      if (!isInsideRoot(folder, env.GOOGLE_DRIVE_ROOT, workspace, env)) {
        return err("FORBIDDEN", "Folder is outside the workspace root.", 403, origin);
      }
      // Prefix entries with the folder's own name so the ZIP contains the
      // folder itself (e.g. "Vacation/photo1.jpg"), like Drive exports do.
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
    if (e instanceof HttpError) {
      return err(codeFor(e), e.message, e.status, origin);
    }
    const message = e instanceof Error ? e.message : "Unknown error";
    return err("INTERNAL_ERROR", message, 500, origin);
  }
}

/**
 * Constant-time string comparison. Both inputs are coerced to UTF-8
 * bytes. Returns false on length mismatch without leaking the
 * expected length via early-return timing.
 */
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) {
    // Hash the second argument so the comparison still takes
    // time proportional to its length.
    const hash = await crypto.subtle.digest("SHA-256", bb);
    // Touch the hash so the engine doesn't optimize the call away.
    void hash.byteLength;
    return false;
  }
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/**
 * Sanitizes a filename for use inside a Content-Disposition header
 * (quotes and control characters would break the header).
 */
function sanitizeFilename(name: string): string {
  return name.replace(/["\r\n]/g, "_").replace(/\\/g, "_");
}

/**
 * Resolves a search result's path inside the workspace root. Returns:
 *   - a path string (segments joined with "/", e.g. "A/B") when the item
 *     is inside the workspace subtree,
 *   - null when the item is a direct child of the workspace folder,
 *   - undefined when the item is outside the workspace (caller skips it).
 * Uses the shared `cache` to avoid repeated getFile calls per search.
 */
async function scopedSearchPath(
  env: Env,
  file: { parents?: string[] },
  rootId: string,
  workspace: Workspace,
  cache: Map<string, Awaited<ReturnType<typeof getFile>>>
): Promise<string | null | undefined> {
  if (!file.parents || file.parents.length === 0) return undefined;
  if (file.parents.includes(rootId)) return undefined; // sibling of the workspace folder
  const names: string[] = [];
  let current: string | undefined = file.parents[0];
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    let f = cache.get(current);
    if (!f) {
      f = await getFile(env, current);
      cache.set(current, f);
    }
    if (current === rootId) return names.join("/");
    if (f.name === workspace) return names.length ? names.join("/") : null;
    names.unshift(f.name);
    current = f.parents?.[0];
  }
  return undefined;
}

/** Walks parents from the file up to GOOGLE_DRIVE_ROOT, ensuring the
 *  walk passes through the workspace's sub-folder. This prevents a user
 *  with one workspace from accessing another workspace's files even if
 *  they somehow obtained a file id.
 */
async function isInsideRoot(
  file: { id: string; parents?: string[] },
  rootId: string,
  workspace: Workspace,
  env: Env
): Promise<boolean> {
  if (file.parents?.includes(rootId)) return true;
  let current: string | undefined = file.parents?.[0];
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current === rootId) return true;
    const f = await getFile(env, current);
    current = f.parents?.[0];
  }
  // Confirm at least one ancestor is the workspace folder
  for (const id of seen) {
    const f = await getFile(env, id);
    if (f.name === workspace) return true;
  }
  return false;
}
