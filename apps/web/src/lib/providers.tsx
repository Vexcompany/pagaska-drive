"use client";

/**
 * The single client-side provider boundary for the entire app.
 * Keeping every provider in this file is the Next.js-recommended
 * pattern: the root `layout.tsx` stays a Server Component, and only
 * this one file is the client boundary. The auth context itself is
 * defined in `auth-context.tsx` so the context object and the hook
 * are guaranteed to share the same React instance.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Workspace } from "@pagaska/shared";
import { AuthContext, type AuthState } from "./auth-context";
import { api, TOKEN_KEY, WORKSPACE_KEY } from "./api";
import { FloatingUploadPanel } from "@/components/FloatingUploadPanel";

/**
 * Storage keys are versioned. The previous version used
 * `pagaska.profile`; this code intentionally reads from both keys
 * during a one-version rollout and always writes to the new ones.
 */
const LEGACY_PROFILE_KEY = "pagaska.profile";

/**
 * When a workspace switch is requested, the target workspace name
 * is stored under this key so the login page can pre-select it.
 * The key is cleared after it is consumed.
 */
export const PENDING_SWITCH_KEY = "pagaska.pendingSwitch";

function readStoredWorkspace(): Workspace | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(WORKSPACE_KEY);
  if (v) return v as Workspace;
  const legacy = window.localStorage.getItem(LEGACY_PROFILE_KEY);
  if (legacy) return legacy as Workspace;
  return null;
}

function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = readStoredToken();
    const w = readStoredWorkspace();
    if (t && w) {
      setToken(t);
      setWorkspace(w);
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (next: Workspace, password: string) => {
    const session = await api.login(next, password);
    window.localStorage.setItem(TOKEN_KEY, session.token);
    window.localStorage.setItem(WORKSPACE_KEY, session.workspace);
    window.localStorage.removeItem(LEGACY_PROFILE_KEY);
    window.localStorage.removeItem(PENDING_SWITCH_KEY);
    setToken(session.token);
    setWorkspace(session.workspace);
  }, []);

  const logout = useCallback(() => {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(WORKSPACE_KEY);
    window.localStorage.removeItem(LEGACY_PROFILE_KEY);
    window.localStorage.removeItem(PENDING_SWITCH_KEY);
    setToken(null);
    setWorkspace(null);
  }, []);

  const switchWorkspace = useCallback((next: Workspace) => {
    // Clear all auth state so the login page does not auto-restore
    // the previous workspace from localStorage.
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(WORKSPACE_KEY);
    window.localStorage.removeItem(LEGACY_PROFILE_KEY);
    // Store a hint so the login page pre-selects the target workspace.
    window.localStorage.setItem(PENDING_SWITCH_KEY, next);
    // Setting workspace to null triggers the redirect to "/" on
    // every authenticated page. The login page will read the hint
    // and pre-select the target workspace.
    setToken(null);
    setWorkspace(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ workspace, token, loading, login, logout, switchWorkspace }),
    [workspace, token, loading, login, logout, switchWorkspace]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {/* Floating upload panel — persists across all pages */}
      <FloatingUploadPanel />
    </AuthContext.Provider>
  );
}
