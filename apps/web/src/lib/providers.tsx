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
import type { Profile } from "@pagaska/shared";
import { AuthContext, type AuthState } from "./auth-context";
import { api } from "./api";

const TOKEN_KEY = "pagaska.token";
const PROFILE_KEY = "pagaska.profile";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_KEY) : null;
    const p = typeof window !== "undefined" ? window.localStorage.getItem(PROFILE_KEY) : null;
    if (t && p) {
      setToken(t);
      setProfile(p as Profile);
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (next: Profile, passphrase: string) => {
    const session = await api.login(next, passphrase);
    window.localStorage.setItem(TOKEN_KEY, session.token);
    window.localStorage.setItem(PROFILE_KEY, session.profile);
    setToken(session.token);
    setProfile(session.profile);
  }, []);

  const logout = useCallback(() => {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(PROFILE_KEY);
    setToken(null);
    setProfile(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ profile, token, loading, login, logout }),
    [profile, token, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
