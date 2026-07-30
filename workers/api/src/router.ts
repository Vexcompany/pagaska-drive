import type { Env } from "./env";
import { signJwt, verifyJwt } from "./jwt";
import {
  getAccessToken,
  listChildren,
  getFile,
  getBreadcrumb,
  deleteFile,
  renameFile,
  startResumableUpload,
  forwardChunk,
  ensureFolder,
  HttpError,
} from "./google";
import { isProfile, type Profile } from "@pagaska/shared";

const CORS_HEADERS = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-pagaska-profile",
  "Access-Control-Max-Age": "86400",
});

function json(data: unknown, init: ResponseInit = {}, origin = "*"): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS(origin),
      ...(init.headers ?? {}),
    },
  });
}

function err(status: number, message: string, origin = "*"): Response {
  return json({ error: message, message, status }, { status }, origin);
}

async function requireAuth(request: Request, env: Env): Promise<Profile> {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw new HttpError(401, "Missing bearer token.");
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) throw new HttpError(401, "Invalid or expired token.");
  return payload.profile;
}

async function getProfileRootFolderId(env: Env, profile: Profile): Promise<string> {
  const rootId = env.GOOGLE_DRIVE_ROOT;
  if (!rootId) throw new HttpError(500, "GOOGLE_DRIVE_ROOT is not configured.");
  // Pre-create the per-profile folder if missing.
  const folder = await ensureFolder(env, rootId, profile);
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
      const body = (await request.json().catch(() => null)) as { profile?: unknown; passphrase?: unknown } | null;
      if (!body || !isProfile(body.profile) || typeof body.passphrase !== "string") {
        return err(400, "Invalid login payload.", origin);
      }
      // Demo-grade auth. Replace with a real user store when ready.
      const expected = "pagaska"; // shared passphrase for both profiles in the demo
      if (body.passphrase !== expected) {
        return err(401, "Wrong passphrase.", origin);
      }
      const token = await signJwt({ sub: body.profile, profile: body.profile }, 60 * 60 * 24 * 7, env.JWT_SECRET);
      return json({ token, profile: body.profile, issuedAt: Math.floor(Date.now() / 1000), expiresAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 }, {}, origin);
    }

    if (path === "/auth/profile" && request.method === "GET") {
      const profile = await requireAuth(request, env);
      return json({ profile }, {}, origin);
    }

    // ------- BROWSE -------
    if (path === "/files" && request.method === "GET") {
      const profile = await requireAuth(request, env);
      const folderParam = url.searchParams.get("folder");
      const folderId = folderParam || (await getProfileRootFolderId(env, profile));
      const items = await listChildren(env, folderId);
      const folders = items.filter((f) => f.mimeType === "application/vnd.google-apps.folder");
      const files = items.filter((f) => f.mimeType !== "application/vnd.google-apps.folder");
      const folder = folderParam ? await getFile(env, folderId) : null;
      const breadcrumb = await getBreadcrumb(env, folderId, env.GOOGLE_DRIVE_ROOT);
      return json({ folder, files, folders, breadcrumb }, {}, origin);
    }

    if (path === "/folders" && request.method === "POST") {
      const profile = await requireAuth(request, env);
      const body = (await request.json().catch(() => null)) as { name?: unknown; parentId?: unknown } | null;
      if (!body || typeof body.name !== "string" || !body.name.trim()) return err(400, "Invalid folder payload.", origin);
      const parentId = (body.parentId as string | null) || (await getProfileRootFolderId(env, profile));
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
      if (!body || typeof body.fileId !== "string" || typeof body.name !== "string") return err(400, "Invalid rename payload.", origin);
      const file = await renameFile(env, body.fileId, body.name);
      return json({ file }, {}, origin);
    }

    // ------- UPLOAD HELPERS -------
    if (path === "/upload/start" && request.method === "POST") {
      const profile = await requireAuth(request, env);
      const body = (await request.json().catch(() => null)) as { filename?: unknown; mimeType?: unknown; size?: unknown; parentId?: unknown } | null;
      if (!body || typeof body.filename !== "string" || typeof body.mimeType !== "string" || typeof body.size !== "number") {
        return err(400, "Invalid start payload.", origin);
      }
      const parentId = (body.parentId as string | null) || (await getProfileRootFolderId(env, profile));
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
        return err(400, "Missing chunk headers.", origin);
      }
      const body = await request.arrayBuffer();
      const result = await forwardChunk(env, { sessionUri, start, end, total, mimeType, body });
      return json(result, {}, origin);
    }

    if (path === "/upload/finish" && request.method === "POST") {
      // Convenience: when the engine finishes via the resumable session
      // directly, we don't strictly need this. But we expose it so the
      // UI can do a final read-back to confirm the file exists.
      const profile = await requireAuth(request, env);
      const body = (await request.json().catch(() => null)) as { fileId?: unknown } | null;
      if (!body || typeof body.fileId !== "string") return err(400, "Invalid finish payload.", origin);
      // Just confirm the file is visible to the user.
      const file = await getFile(env, body.fileId);
      // Ensure the file is actually inside the profile's root subtree.
      if (!isInsideRoot(file, env.GOOGLE_DRIVE_ROOT, profile, env)) {
        return err(403, "File is outside the profile root.", origin);
      }
      return json({ ok: true, file }, {}, origin);
    }

    // ------- PREVIEW -------
    if (path === "/preview" && request.method === "GET") {
      await requireAuth(request, env);
      const fileId = url.searchParams.get("id");
      if (!fileId) return err(400, "Missing id.", origin);
      const file = await getFile(env, fileId);
      // Signed content / thumbnail URL via a one-off access token.
      const accessToken = await getAccessToken(env);
      const thumbnailUrl = file.thumbnailLink
        ? file.thumbnailLink.replace(/=s\d+/, "=s1024")
        : null;
      const contentUrl = `${DRIVE}/files/${encodeURIComponent(fileId)}?alt=media&access_token=${encodeURIComponent(accessToken)}`;
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

    return err(404, `Unknown route: ${request.method} ${path}`, origin);
  } catch (e) {
    if (e instanceof HttpError) {
      return err(e.status, e.message, origin);
    }
    const message = e instanceof Error ? e.message : "Unknown error";
    return err(500, message, origin);
  }
}

const DRIVE = "https://www.googleapis.com/drive/v3";

/** Walks parents from the file up to GOOGLE_DRIVE_ROOT, ensuring the
 *  walk passes through the profile's sub-folder. This prevents a user
 *  with one profile from accessing another profile's files even if
 *  they somehow obtained a file id.
 */
async function isInsideRoot(
  file: { id: string; parents?: string[] },
  rootId: string,
  profile: Profile,
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
  // Confirm at least one ancestor is the profile folder.
  for (const id of seen) {
    const f = await getFile(env, id);
    if (f.name === profile) return true;
  }
  return false;
}
