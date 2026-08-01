"use client";

/**
 * Auth context — created in its own client-only module so the context
 * object and the hook are guaranteed to come from the same React
 * instance on the client. The provider lives in `providers.tsx` so the
 * root `layout.tsx` has a single, clean client boundary. 
 */

import { createContext, useContext } from "react";
import type { Workspace } from "@pagaska/shared";

export interface AuthState {
  workspace: Workspace | null;
  token: string | null;
  loading: boolean;
  login(workspace: Workspace, password: string): Promise<void>;
  logout(): void;
  switchWorkspace(next: Workspace): void;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
