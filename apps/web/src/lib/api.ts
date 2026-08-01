"use client";

import type {
  ApiErrorCode,
  AuthSession,
  CreateFolderRequest,
  DriveFile,
  DriveFolder,
  FinishUploadRequest,
  FinishUploadResponse,
  ListFilesResponse,
  LoginRequest,
  MoveRequest,
  MoveResponse,
  PreviewResponse,
  RenameRequest,
  SearchResponse,
  ShareRequest,
  ShareResponse,
  ShareStatusResponse,
  StartUploadRequest,
  StartUploadResponse,
  TrashDeleteForeverRequest,
  TrashDeleteForeverResponse,
  TrashListResponse,
  TrashRequest,
  TrashResponse,
  TrashRestoreRequest,
  TrashRestoreResponse,
  TrashSearchResponse,
  Workspace,
} from "@pagaska/shared";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8787";

/** Maximum items per batch request (must match the backend MAX_BATCH). */
export const MAX_BATCH = 20;

/** Progress state for a batched operation across multiple API calls. */
export interface BatchProgress {
  total: number;
  done: number;
  failed: string[];
  succeeded: string[];
  running: boolean;
}

/**
 * Split `ids` into chunks of MAX_BATCH and call `fn` sequentially.
 * Reports progress after each chunk.  Continues on partial failure
 * so the caller can show which items failed.
 */
export async function batchOperation(
  ids: string[],
  fn: (batchIds: string[]) => Promise<{ succeeded: number; failed: string[] }>,
  onProgress?: (progress: BatchProgress) => void,
): Promise<BatchProgress> {
  const progress: BatchProgress = { total: ids.length, done: 0, failed: [], succeeded: [], running: true };
  onProgress?.(progress);

  for (let i = 0; i < ids.length; i += MAX_BATCH) {
    const chunk = ids.slice(i, i + MAX_BATCH);
    try {
      const res = await fn(chunk);
      progress.succeeded.push(...chunk.slice(0, res.succeeded));
      progress.failed.push(...res.failed);
      progress.done += chunk.length;
    } catch {
      // Entire chunk failed — treat all items as failed
      progress.failed.push(...chunk);
      progress.done += chunk.length;
    }
    onProgress?.(progress);
  }

  progress.running = false;
  onProgress?.(progress);
  return progress;
}

/**
 * Structured API error. The Worker always returns
 * `{success: false, code, message, status}` on the failure path.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const TOKEN_KEY = "pagaska.token";
const WORKSPACE_KEY = "pagaska.workspace";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    throw new ApiError(0, "INTERNAL_ERROR", err instanceof Error ? err.message : "Network error.");
  }
  if (!res.ok) {
    let code: ApiErrorCode = "INTERNAL_ERROR";
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { code?: ApiErrorCode; message?: string };
      if (data?.code) code = data.code;
      if (data?.message) message = data.message;
    } catch {
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

export const api = {
  async login(workspace: Workspace, password: string): Promise<AuthSession> {
    const body: LoginRequest = { workspace, password };
    return call<AuthSession>("/auth/login", { method: "POST", body: JSON.stringify(body) });
  },
  async profile(): Promise<{ workspace: Workspace }> {
    return call("/auth/profile");
  },
  async listWorkspaces(): Promise<{ workspaces: Workspace[] }> {
    return call("/auth/workspaces");
  },
  async listFiles(folderId: string | null = null): Promise<ListFilesResponse> {
    const q = folderId ? `?folder=${encodeURIComponent(folderId)}` : "";
    return call<ListFilesResponse>(`/files${q}`);
  },
  async createFolder(req: CreateFolderRequest): Promise<{ folder: DriveFolder }> {
    return call("/folders", { method: "POST", body: JSON.stringify(req) });
  },
  /** Move to trash (replaces the old permanent delete). */
  async deleteFile(id: string): Promise<{ ok: true }> {
    return call(`/files/${id}`, { method: "DELETE" });
  },
  async rename(req: RenameRequest): Promise<{ file: DriveFile }> {
    return call("/rename", { method: "PATCH", body: JSON.stringify(req) });
  },
  async startUpload(req: StartUploadRequest): Promise<StartUploadResponse> {
    return call("/upload/start", { method: "POST", body: JSON.stringify(req) });
  },
  async finishUpload(req: FinishUploadRequest): Promise<FinishUploadResponse> {
    const fileId = await readFileIdFromSession(req.sessionUri);
    return call<FinishUploadResponse>("/upload/finish", { method: "POST", body: JSON.stringify({ fileId }) });
  },
  async preview(id: string): Promise<PreviewResponse> {
    return call(`/preview?id=${encodeURIComponent(id)}`);
  },
  async share(fileId: string): Promise<ShareResponse> {
    const body: ShareRequest = { fileId };
    return call<ShareResponse>("/share", { method: "POST", body: JSON.stringify(body) });
  },
  async shareStatus(fileId: string): Promise<ShareStatusResponse> {
    return call<ShareStatusResponse>(`/share?id=${encodeURIComponent(fileId)}`);
  },
  async search(q: string): Promise<SearchResponse> {
    return call<SearchResponse>(`/search?q=${encodeURIComponent(q)}`);
  },
  async move(req: MoveRequest): Promise<MoveResponse> {
    return call<MoveResponse>("/move", { method: "POST", body: JSON.stringify(req) });
  },

  // ── Trash ──────────────────────────────────────────────────────────────

  /** List all trashed items in the workspace. */
  async listTrash(): Promise<TrashListResponse> {
    return call<TrashListResponse>("/trash");
  },
  /** Move items to trash (batch). */
  async trashItems(req: TrashRequest): Promise<TrashResponse> {
    return call<TrashResponse>("/trash", { method: "POST", body: JSON.stringify(req) });
  },
  /** Restore items from trash (batch). */
  async restoreItems(req: TrashRestoreRequest): Promise<TrashRestoreResponse> {
    return call<TrashRestoreResponse>("/trash/restore", { method: "POST", body: JSON.stringify(req) });
  },
  /** Permanently delete items ("Delete Forever"). */
  async deleteForever(req: TrashDeleteForeverRequest): Promise<TrashDeleteForeverResponse> {
    return call<TrashDeleteForeverResponse>("/trash", { method: "DELETE", body: JSON.stringify(req) });
  },
  /** Search within trashed items. */
  async searchTrash(q: string): Promise<TrashSearchResponse> {
    return call<TrashSearchResponse>(`/trash/search?q=${encodeURIComponent(q)}`);
  },
};

export { TOKEN_KEY, WORKSPACE_KEY };

async function readFileIdFromSession(_sessionUri: string): Promise<string> {
  return "";
}
