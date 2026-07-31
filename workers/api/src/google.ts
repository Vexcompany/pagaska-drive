/**
 * Google Drive API helpers — runs server-side only inside the Worker.
 *
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
  const q = `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false`;
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
      if (m) return { acknowledged: Number(m[1]) + 1, finished: false, driveFileId: null };
    }
    return { acknowledged: args.end, finished: false, driveFileId: null };
  }
  if (res.status === 200 || res.status === 201) {
    const body = (await res.json().catch(() => null)) as { id?: string } | null;
    return { acknowledged: args.total, finished: true, driveFileId: body?.id ?? null };
  }
  throw new HttpError(res.status, "DRIVE_ERROR", await res.text());
}
