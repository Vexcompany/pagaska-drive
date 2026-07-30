/**
 * Shared types between the Next.js app, the Cloudflare Worker, and the
 * upload engine. Anything in here MUST be safe to import in all three
 * runtimes (browser, edge worker, node tests).
 */

export const PROFILES = ["pagaska", "osama"] as const;
export type Profile = (typeof PROFILES)[number];

export function isProfile(value: unknown): value is Profile {
  return typeof value === "string" && (PROFILES as readonly string[]).includes(value);
}

export interface AuthSession {
  /** Opaque JWT issued by the Worker. */
  token: string;
  /** Selected Pagaska profile. */
  profile: Profile;
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
  /** A short-lived, signed Google content URL. */
  contentUrl: string | null;
  webViewLink: string | null;
}

export interface LoginRequest {
  /** Profile to sign in as. */
  profile: Profile;
  /** Shared passphrase for the demo deployment. Replace with real auth. */
  passphrase: string;
}

export interface ApiError {
  error: string;
  message: string;
  status: number;
}
