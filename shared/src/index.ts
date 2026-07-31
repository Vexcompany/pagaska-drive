/**
 * Shared types between the Next.js app, the Cloudflare Worker, and the
 * upload engine. Anything in here MUST be safe to import in all three
 * runtimes (browser, edge worker, node tests).
 */

export const WORKSPACES = ["pagaska", "osama", "pmr"] as const;
export type Workspace = (typeof WORKSPACES)[number];

export function isWorkspace(value: unknown): value is Workspace {
  return typeof value === "string" && (WORKSPACES as readonly string[]).includes(value);
}

/**
 * @deprecated Use `Workspace` instead. The previous `Profile` type
 * is kept as a type-only alias so older imports continue to typecheck.
 * The runtime array has been renamed to `WORKSPACES`.
 */
export type Profile = Workspace;

/**
 * @deprecated Use `WORKSPACES` instead.
 */
export const PROFILES = WORKSPACES;

export interface AuthSession {
  /** Opaque JWT issued by the Worker. */
  token: string;
  /** Authenticated workspace. */
  workspace: Workspace;
  /** Unix epoch seconds. */
  issuedAt: number;
  /** Unix epoch seconds. */
  expiresAt: number;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  /** Drive parents (folder ids). */
  parents: string[];
  /** WebView / thumbnail link from Drive. */
  thumbnailLink: string | null;
  webViewLink: string | null;
  modifiedTime: string | null;
}

export interface DriveFolder extends DriveFile {
  mimeType: "application/vnd.google-apps.folder";
}

export interface ListFilesResponse {
  folder: DriveFolder | null;
  files: DriveFile[];
  folders: DriveFolder[];
  /** Resolved path segments for breadcrumb rendering. */
  breadcrumb: { id: string; name: string }[];
}

export interface StartUploadRequest {
  /** Original filename as it should appear in Drive. */
  filename: string;
  mimeType: string;
  /** Total file size in bytes. */
  size: number;
  /** Drive folder id to upload into. */
  parentId: string | null;
}

export interface StartUploadResponse {
  /** The Google Drive resumable session URI to PUT chunks to. */
  sessionUri: string;
  /** Total size echoed back so the client can sanity-check. */
  totalBytes: number;
}

export interface FinishUploadRequest {
  /** sessionUri returned by /upload/start. */
  sessionUri: string;
  /** Total file size in bytes. */
  size: number;
  /** Drive folder id to upload into. */
  parentId: string | null;
  /** Filename. */
  filename: string;
  mimeType: string;
}

export interface FinishUploadResponse {
  driveFileId: string;
  name: string;
  size: number;
}

export interface CreateFolderRequest {
  name: string;
  parentId: string | null;
}

export interface RenameRequest {
  fileId: string;
  name: string;
}

export interface PreviewResponse {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  /** A short-lived, signed Google thumbnail URL (or `null` if not available). */
  thumbnailUrl: string | null;
  /** Worker-proxied content URL (GET /media?id=…). The browser never talks
   *  to Google directly; the Worker streams the bytes with CORS headers. */
  contentUrl: string | null;
  webViewLink: string | null;
}

export interface ShareRequest {
  /** Drive file or folder id to make public. */
  fileId: string;
}

export interface ShareResponse {
  /** The public webViewLink that works without a Google login (incognito). */
  webViewLink: string;
}

export interface ShareStatusResponse {
  /** True when an "anyone / reader" permission exists. */
  public: boolean;
  /** Role of the public permission ("reader" when public). */
  role: string | null;
  /** The public webViewLink (null while restricted). */
  webViewLink: string | null;
}

export interface SearchItem extends DriveFile {
  /** Resolved path from the workspace root, e.g. "A/B" (null when the item is directly under the workspace folder). */
  path: string | null;
}

export interface SearchResponse {
  files: SearchItem[];
  folders: SearchItem[];
}

export interface MoveRequest {
  /** File or folder ids to move. */
  fileIds: string[];
  /** Destination folder id (null = workspace root). */
  parentId: string | null;
}

export interface MoveResponse {
  ok: boolean;
  moved: number;
}

export interface LoginRequest {
  /** Workspace to sign in as. */
  workspace: Workspace;
  /** Workspace password, validated server-side against a runtime secret. */
  password: string;
}

/**
 * Standardised error envelope returned by every Worker endpoint on
 * the failure path. Successes continue to return their own typed
 * payload; this shape is only used for non-2xx responses.
 */
export interface ApiErrorResponse {
  success: false;
  code: ApiErrorCode;
  message: string;
  status: number;
}

/**
 * Machine-readable error codes. Stable across releases so the
 * frontend can branch on them without parsing messages.
 */
export type ApiErrorCode =
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

