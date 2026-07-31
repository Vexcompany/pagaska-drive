"use client";

/**
 * The single client-side provider boundary for the entire app.
 *
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

/**
 * Storage keys are versioned. The previous version used
 * `pagaska.profile`; this code intentionally reads from both keys
 * during a one-version rollout and always writes to the new ones.
 */
const LEGACY_PROFILE_KEY = "pagaska.profile";

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
    setToken(session.token);
    setWorkspace(session.workspace);
  }, []);

  const logout = useCallback(() => {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(WORKSPACE_KEY);
    window.localStorage.removeItem(LEGACY_PROFILE_KEY);
    setToken(null);
    setWorkspace(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ workspace, token, loading, login, logout }),
    [workspace, token, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
