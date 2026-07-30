/**
 * Core type definitions for the Pagaska Drive upload engine.
 *
 * Everything is intentionally serializable so that queue state, progress,
 * and resumable session metadata can be persisted to localStorage and
 * restored after a page refresh.
 */

/** Per-file state machine. */
export type FileState =
  | "queued"
  | "preparing"
  | "uploading"
  | "paused"
  | "retrying"
  | "completed"
  | "failed"
  | "canceled";

/** Distinguishes the two independent scheduler pools. */
export type UploadPool = "normal" | "retry";

/**
 * Lightweight description of a file to upload.
 *
 * `File` is a browser-only type; we keep the engine usable from Node test
 * harnesses by accepting any object that quacks like a File.
 */
export interface UploadSource {
  /** The browser File object, or a polyfill / Node Blob. */
  file: Blob;
  /** Original relative path inside the parent folder, e.g. "docs/2026/report.pdf". */
  relativePath: string;
  /** Display name (defaults to file.name). */
  name?: string;
  /** Size in bytes — required so the engine never has to await the whole file. */
  size: number;
  /** MIME type — defaults to "application/octet-stream". */
  mimeType?: string;
}

/** Persisted metadata for a Google Drive resumable session. */
export interface ResumableSession {
  /** The session URI returned by the Drive init request. */
  sessionUri: string;
  /** Bytes the server has already acknowledged. */
  bytesUploaded: number;
  /** Total size of the file at the time the session was opened. */
  totalBytes: number;
  /** Target Drive folder ID. */
  parentId: string | null;
  /** Filename as it will appear in Drive. */
  filename: string;
  /** MIME type. */
  mimeType: string;
  /** Wall-clock time the session was opened. */
  openedAt: number;
}

/** Snapshot of a single file's progress. */
export interface UploadFileSnapshot {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  bytesUploaded: number;
  state: FileState;
  pool: UploadPool | null;
  attempt: number;
  errorMessage: string | null;
  speedBps: number;
  startedAt: number | null;
  completedAt: number | null;
  /** Drive file ID once the upload completes. */
  driveFileId: string | null;
}

/** Aggregate snapshot consumed by the UI. */
export interface ProgressSnapshot {
  totalBytes: number;
  uploadedBytes: number;
  totalFiles: number;
  uploadedFiles: number;
  failedFiles: number;
  retryingFiles: number;
  queuedFiles: number;
  currentFiles: UploadFileSnapshot[];
  overallSpeedBps: number;
  remainingSeconds: number | null;
  /** 0..1 */
  fraction: number;
}

/** Engine configuration — every knob is exposed. */
export interface UploadEngineConfig {
  /** Bytes per chunk. */
  chunkSize: number;
  /** Concurrent normal uploads. */
  normalConcurrency: number;
  /** Concurrent retries (independent pool). */
  retryConcurrency: number;
  /** Max retry attempts per file before giving up. */
  maxRetries: number;
  /** Backoff delay in seconds, indexed by attempt (1-based). */
  backoffSeconds: number[];
  /** Per-chunk HTTP request timeout. */
  requestTimeoutMs: number;
  /** Target Drive folder; null = Drive root. */
  parentFolderId: string | null;
  /** Async access-token provider. */
  getAccessToken: () => Promise<string>;
  /** localStorage key for persisting session metadata. */
  sessionPersistKey: string;
  /** Where to read/write the session store. Defaults to localStorage when available. */
  storage?: SessionStorage;
  /** Progress callback (fires ~10×/sec). */
  onProgress?: (snapshot: ProgressSnapshot) => void;
  /** Per-file state change callback. */
  onFileStateChange?: (file: UploadFileSnapshot) => void;
  /** Optional logger. */
  logger?: Logger;
}

/** Storage abstraction so the engine works in Node and in browsers. */
export interface SessionStorage {
  read(): Record<string, ResumableSession>;
  write(data: Record<string, ResumableSession>): void;
  clear(): void;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Internal model: a file wrapped with engine metadata. */
export interface QueuedFile {
  id: string;
  source: UploadSource;
  state: FileState;
  pool: UploadPool | null;
  attempt: number;
  bytesUploaded: number;
  errorMessage: string | null;
  driveFileId: string | null;
  startedAt: number | null;
  completedAt: number | null;
  /** Resumable session, if one has been opened. */
  session: ResumableSession | null;
  /** Last error that caused a retry. */
  lastError: UploadError | null;
  /** Rolling byte-count samples for speed calculation. */
  speedSamples: Array<{ t: number; bytes: number }>;
}

/** Distinguishes errors the engine can recover from. */
export class UploadError extends Error {
  readonly recoverable: boolean;
  readonly status: number | null;
  readonly cause?: unknown;

  constructor(
    message: string,
    options: { recoverable: boolean; status?: number | null; cause?: unknown } = { recoverable: false }
  ) {
    super(message);
    this.name = "UploadError";
    this.recoverable = options.recoverable;
    this.status = options.status ?? null;
    this.cause = options.cause;
  }
}

export const isRecoverableStatus = (status: number | null): boolean => {
  if (status === null) return true; // network failure etc.
  if (status === 408 || status === 425 || status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
};
