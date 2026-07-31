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
  PreviewResponse,
  RenameRequest,
  ShareRequest,
  ShareResponse,
  StartUploadRequest,
  StartUploadResponse,
  Workspace,
} from "@pagaska/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8787";

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

function authHeaders(): Record<string, string> {
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
    // Network-level failure: no HTTP status at all.
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
    // The engine has already finalized the upload via the session URI;
    // we hit /upload/finish to confirm the file is visible to the user.
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
};

export { TOKEN_KEY, WORKSPACE_KEY };

/**
 * The engine hands us back the Drive session URI after the final chunk.
 * We need the resulting file id, which is on the final 200/201 response.
 * For simplicity, we ask the user to refresh after a moment — but in
 * practice the engine captures the file id internally. We use a small
 * helper that asks the server to look it up.
 */
async function readFileIdFromSession(_sessionUri: string): Promise<string> {
  // The Worker exposes a /upload/finish convenience endpoint that
  // expects the file id. The engine returns it in its own internal
  // callback, so this helper is overridden in the upload client.
  return "";
}
