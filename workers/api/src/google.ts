/**
 * Google Drive API helpers — runs server-side only inside the Worker.
 * Every function takes the access token explicitly so we can swap it
 * for a fresh one via `getAccessToken` on every request. The browser
 * never sees these tokens.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export type HttpErrorCode =
  | "INVALID_LOGIN_PAYLOAD"
  | "INVALID_CREDENTIALS"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_PAYLOAD"
  | "MISSING_QUERY_PARAM"
  | "DRIVE_ERROR"
  | "INTERNAL_ERROR"
  | "NOT_FOUND"
  | "MISSING_CONFIG"
  | "CONFIG_ERROR";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: HttpErrorCode,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface TokenCacheEntry {
  accessToken: string;
  expiresAt: number;
}

export async function getAccessToken(env: { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string; GOOGLE_REFRESH_TOKEN: string }): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(res.status, "CONFIG_ERROR", `Google token exchange failed: ${text}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return data.access_token;
}

async function authedFetch(url: string, init: RequestInit, env: Parameters<typeof getAccessToken>[0]): Promise<Response> {
  const token = await getAccessToken(env);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: string | null;
  parents: string[];
  thumbnailLink: string | null;
  webViewLink: string | null;
  modifiedTime: string | null;
}

/** Find a folder by name inside a parent. Returns `null` if not found. */
export async function findFolder(env: Parameters<typeof getAccessToken>[0], parentId: string, name: string): Promise<DriveFile | null> {
  // Defensive: normalize the name to a string before .replace to
  // avoid runtime errors if the caller ever passes `undefined`.
  const safeName = typeof name === "string" ? name : "";
  const q = `mimeType='application/vnd.google-apps.folder' and name='${safeName.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false`;
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,parents,thumbnailLink,webViewLink,modifiedTime)`;
  const res = await authedFetch(url, { method: "GET" }, env);
  if (!res.ok) throw new HttpError(res.status, "DRIVE_ERROR", await res.text());
  const data = (await res.json()) as { files: DriveFile[] };
  return data.files[0] ?? null;
}

export async function createFolder(env: Parameters<typeof getAccessToken>[0], parentId: string, name: string): Promise<DriveFile> {
  const res = await authedFetch(
    `${DRIVE_API}/files`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
    },
    env
  );
  if (!res.ok) throw new HttpError(res.status, "DRIVE_ERROR", await res.text());
  return (await res.json()) as DriveFile;
}

export async function ensureFolder(env: Parameters<typeof getAccessToken>[0], parentId: string, name: string): Promise<DriveFile> {
  const existing = await findFolder(env, parentId, name);
  if (existing) return existing;
  return createFolder(env, parentId, name);
}

export async function listChildren(env: Parameters<typeof getAccessToken>[0], folderId: string | null): Promise<DriveFile[]> {
  const q = folderId
    ? `'${folderId}' in parents and trashed=false`
    : `'root' in parents and trashed=false`;
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,parents,thumbnailLink,webViewLink,modifiedTime)&pageSize=1000&orderBy=folder,name`;
  const res = await authedFetch(url, { method: "GET" }, env);
  if (!res.ok) throw new HttpError(res.status, "DRIVE_ERROR", await res.text());
  const data = (await res.json()) as { files: DriveFile[] };
  return data.files;
}

export async function getFile(env: Parameters<typeof getAccessToken>[0], fileId: string): Promise<DriveFile> {
  const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,parents,thumbnailLink,webViewLink,modifiedTime`;
  const res = await authedFetch(url, { method: "GET" }, env);
  if (!res.ok) throw new HttpError(res.status, "DRIVE_ERROR", await res.text());
  return (await res.json()) as DriveFile;
}

export async function getBreadcrumb(env: Parameters<typeof getAccessToken>[0], folderId: string, rootId: string): Promise<{ id: string; name: string }[]> {
  const crumbs: { id: string; name: string }[] = [];
  let current: string | null = folderId;
  const seen = new Set<string>();
  while (current && current !== rootId && !seen.has(current)) {
    seen.add(current);
    const f = await getFile(env, current);
    crumbs.unshift({ id: f.id, name: f.name });
    current = f.parents?.[0] ?? null;
  }
  return crumbs;
}

export async function deleteFile(env: Parameters<typeof getAccessToken>[0], fileId: string): Promise<void> {
  const res = await authedFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" }, env);
  if (!res.ok && res.status !== 204) throw new HttpError(res.status, "DRIVE_ERROR", await res.text());
}

export async function renameFile(env: Parameters<typeof getAccessToken>[0], fileId: string, name: string): Promise<DriveFile> {
  const res = await authedFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
    env
  );
  if (!res.ok) throw new HttpError(res.status, "DRIVE_ERROR", await res.text());
  return (await res.json()) as DriveFile;
}

/**
 * Stream the raw file content from Drive (`alt=media`) with the Worker's
 * access token. The optional `range` header (e.g. "bytes=0-1023") is
 * forwarded so the browser can seek inside videos/audios (206 responses).
 * The caller wraps the returned body in a CORS-enabled Response.
 */
export async function fetchMedia(
  env: Parameters<typeof getAccessToken>[0],
  fileId: string,
  range?: string | null
): Promise<Response> {
  const token = await getAccessToken(env);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (range) headers.Range = range;
  const res = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, {
    method: "GET",
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(res.status, "DRIVE_ERROR", text || `Drive media request failed with ${res.status}`);
  }
  return res;
}

/**
 * Recursive, case-insensitive, partial-name search across the whole
 * Drive (any depth). Drive's `name contains` matches partial names
 * case-insensitively and is not limited to a single folder, so nested
 * files and folders are found. The caller scopes results to the
 * workspace root.
 */
export async function searchDrive(
  env: Parameters<typeof getAccessToken>[0],
  query: string
): Promise<DriveFile[]> {
  const safe = query.replace(/'/g, "\\'");
  const q = `name contains '${safe}' and trashed = false`;
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,parents,thumbnailLink,webViewLink,modifiedTime)&pageSize=200&orderBy=folder,name`;
  const res = await authedFetch(url, { method: "GET" }, env);
  if (!res.ok) throw new HttpError(res.status, "DRIVE_ERROR", await res.text());
  const data = (await res.json()) as { files: DriveFile[] };
  return data.files ?? [];
}

export interface PermissionInfo {
  id: string | null;
  type: string | null;
  role: string | null;
  allowFileDiscovery: boolean | null;
}

/** Lists the permissions attached to a file or folder. */
export async function listPermissions(
  env: Parameters<typeof getAccessToken>[0],
  fileId: string
): Promise<PermissionInfo[]> {
  const res = await authedFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(id,type,role,allowFileDiscovery)`,
    { method: "GET" },
    env
  );
  if (!res.ok) throw new HttpError(res.status, "DRIVE_ERROR", await res.text());
  const data = (await res.json()) as {
    permissions?: Array<{ id?: string; type?: string; role?: string; allowFileDiscovery?: boolean }>;
  };
  return (data.permissions ?? []).map((p) => ({
    id: p.id ?? null,
    type: p.type ?? null,
    role: p.role ?? null,
    allowFileDiscovery: p.allowFileDiscovery ?? null,
  }));
}

/** Move a file or folder to another parent (Drive PATCH with add/removeParents). */
export async function moveFile(
  env: Parameters<typeof getAccessToken>[0],
  fileId: string,
  newParentId: string
): Promise<DriveFile> {
  const file = await getFile(env, fileId);
  const oldParents = (file.parents ?? []).join(",");
  const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?addParents=${encodeURIComponent(newParentId)}&removeParents=${encodeURIComponent(oldParents)}`;
  const res = await authedFetch(
    url,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" },
    env
  );
  if (!res.ok) throw new HttpError(res.status, "DRIVE_ERROR", await res.text());
  return (await res.json()) as DriveFile;
}

export interface SubtreeEntry {
  path: string;
  data: Uint8Array;
}

/**
 * Recursively collects every file under a folder as {path, bytes} pairs
 * so the caller can build a ZIP. Folders become empty entries with a
 * trailing "/". Files that fail to fetch (e.g. Google-native docs) are
 * skipped so one bad entry never fails the whole download.
 */
export async function collectSubtree(
  env: Parameters<typeof getAccessToken>[0],
  folderId: string,
  prefix: string
): Promise<SubtreeEntry[]> {
  const children = await listChildren(env, folderId);
  const out: SubtreeEntry[] = [];
  for (const child of children) {
    const rel = prefix ? `${prefix}/${child.name}` : child.name;
    if (child.mimeType === "application/vnd.google-apps.folder") {
      out.push({ path: `${rel}/`, data: new Uint8Array(0) });
      out.push(...(await collectSubtree(env, child.id, rel)));
    } else {
      try {
        const media = await fetchMedia(env, child.id);
        const buf = await media.arrayBuffer();
        out.push({ path: rel, data: new Uint8Array(buf) });
      } catch {
        // Unfetchable file (Google Docs/Sheets/Slides, quota hiccup):
        // skip rather than fail the entire folder download.
      }
    }
  }
  return out;
}

/**
 * Make a file or folder readable by anyone with the link. Drive treats
 * folders as files for permissions, so this works for both. The check
 * lists existing permissions first and only creates one when the file is
 * still restricted (no `anyone`/`reader` entry yet), so re-sharing an
 * already-public item is a no-op.
 */
export async function ensurePublicPermission(
  env: Parameters<typeof getAccessToken>[0],
  fileId: string
): Promise<DriveFile> {
  const permissions = await listPermissions(env, fileId);
  const alreadyPublic = permissions.some((p) => p.type === "anyone" && p.role === "reader");
  if (!alreadyPublic) {
    const createRes = await authedFetch(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "anyone", allowFileDiscovery: false }),
      },
      env
    );
    if (!createRes.ok) throw new HttpError(createRes.status, "DRIVE_ERROR", await createRes.text());
  }
  const file = await getFile(env, fileId);
  if (!file.webViewLink) {
    throw new HttpError(500, "INTERNAL_ERROR", "Drive did not return a webViewLink.");
  }
  return file;
}

/**
 * Open a resumable upload session in Drive. Returns the Location
 * header which the browser uses to PUT chunks.
 */
export async function startResumableUpload(
  env: Parameters<typeof getAccessToken>[0],
  args: { filename: string; mimeType: string; size: number; parentId: string | null }
): Promise<{ sessionUri: string; totalBytes: number }> {
  const metadata: Record<string, unknown> = { name: args.filename, mimeType: args.mimeType };
  if (args.parentId) metadata.parents = [args.parentId];
  const res = await authedFetch(
    `${DRIVE_UPLOAD}/files?uploadType=resumable`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": args.mimeType,
        "X-Upload-Content-Length": String(args.size),
      },
      body: JSON.stringify(metadata),
    },
    env
  );
  if (!res.ok) throw new HttpError(res.status, "DRIVE_ERROR", await res.text());
  const sessionUri = res.headers.get("Location");
  if (!sessionUri) throw new HttpError(500, "INTERNAL_ERROR", "Drive did not return a Location header.");
  return { sessionUri, totalBytes: args.size };
}

/**
 * Forward a chunk PUT to Drive using the session URI. Returns the
 * number of bytes the server has acknowledged and the new file id
 * (if the chunk was the final one).
 */
export async function forwardChunk(
  env: Parameters<typeof getAccessToken>[0],
  args: {
    sessionUri: string;
    start: number;
    end: number;
    total: number;
    mimeType: string;
    body: ArrayBuffer;
  }
): Promise<{ acknowledged: number; finished: boolean; driveFileId: string | null }> {
  const token = await getAccessToken(env);
  const res = await fetch(args.sessionUri, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": args.mimeType,
      "Content-Range": `bytes ${args.start}-${args.end - 1}/${args.total}`,
    },
    body: args.body,
  });
  if (res.status === 308) {
    const range = res.headers.get("Range");
    if (range) {
      const m = /bytes=0-(\d+)/.exec(range);
      if (m) {
        const acknowledged = Number(m[1]) + 1;
        // Drive has every byte but answered 308 because the last chunk
        // ended on a 256 KiB boundary, so the session is not finalized
        // until the client sends the empty final request. Without this
        // step the upload is never marked complete and the file stays
        // stuck in "uploading" on the client.
        if (acknowledged >= args.total) {
          const finalRes = await fetch(args.sessionUri, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Range": `bytes */${args.total}`,
            },
          });
          if (finalRes.status === 200 || finalRes.status === 201) {
            const body = (await finalRes.json().catch(() => null)) as { id?: string } | null;
            return { acknowledged: args.total, finished: true, driveFileId: body?.id ?? null };
          }
        }
        return { acknowledged, finished: false, driveFileId: null };
      }
    }
    return { acknowledged: args.end, finished: false, driveFileId: null };
  }
  if (res.status === 200 || res.status === 201) {
    const body = (await res.json().catch(() => null)) as { id?: string } | null;
    return { acknowledged: args.total, finished: true, driveFileId: body?.id ?? null };
  }
  throw new HttpError(res.status, "DRIVE_ERROR", await res.text());
}
