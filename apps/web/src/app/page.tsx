"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api, ApiError } from "@/lib/api";
import { WORKSPACES, type Workspace } from "@pagaska/shared";

export default function LoginPage() {
  const { workspace, loading, login } = useAuth();
  const router = useRouter();
  const [selected, setSelected] = useState<Workspace>("pagaska");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!loading && workspace) router.replace("/drive");
  }, [loading, workspace, router]);

  // Fetch the canonical workspace list at mount so a new workspace
  // added server-side appears in the UI without redeploying the
  // frontend. Falls back to the static list if the request fails
  // (e.g. Worker down in dev) so the UI is never empty.
  const [knownWorkspaces, setKnownWorkspaces] = useState<readonly Workspace[]>(WORKSPACES);
  useEffect(() => {
    let cancelled = false;
    api
      .listWorkspaces()
      .then((r) => {
        if (cancelled) return;
        if (Array.isArray(r.workspaces) && r.workspaces.length > 0) {
          setKnownWorkspaces(r.workspaces as readonly Workspace[]);
        }
      })
      .catch(() => {
        /* keep static fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const passwordEmpty = password.length === 0;
  const passwordTooShort = password.length > 0 && password.length < 4;
  const showValidation = touched && (passwordEmpty || passwordTooShort);
  const canSubmit = useMemo(
    () => !busy && !loading && password.length >= 1,
    [busy, loading, password.length]
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (password.length < 1) return;
    setBusy(true);
    try {
      await login(selected, password);
      router.replace("/drive");
    } catch (err) {
      if (err instanceof ApiError) {
        switch (err.code) {
          case "INVALID_CREDENTIALS":
            setError("The password you entered is incorrect for this workspace.");
            break;
          case "CONFIG_ERROR":
            setError(
              "This workspace is not yet configured on the server. Please contact the operator."
            );
            break;
          case "INVALID_LOGIN_PAYLOAD":
            setError("Please select a workspace and enter a password.");
            break;
          default:
            setError(err.message);
        }
      } else {
        setError(err instanceof Error ? err.message : "Login failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 sm:p-6">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-2xl font-semibold mb-1">Pagaska Drive</h1>
        <p className="text-sm text-slate-500 mb-6">
          {loading ? "Loading your session…" : "Sign in to your workspace."}
        </p>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div>
            <label className="label">Workspace</label>
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${Math.min(knownWorkspaces.length, 3)}, minmax(0, 1fr))` }}
            >
              {knownWorkspaces.map((w) => (
                <button
                  type="button"
                  key={w}
                  onClick={() => setSelected(w)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium capitalize transition ${
                    selected === w
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="password">
              Workspace password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => setTouched(true)}
                className="input pr-20"
                autoComplete="current-password"
                placeholder="Enter your workspace password"
                aria-invalid={showValidation || undefined}
                aria-describedby="password-help"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-2 my-1 px-2 text-xs text-slate-500 hover:text-slate-700"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            {showValidation ? (
              <p id="password-help" className="mt-1 text-xs text-red-600">
                {passwordEmpty
                  ? "Password is required."
                  : "Password is too short."}
              </p>
            ) : (
              <p id="password-help" className="mt-1 text-xs text-slate-400">
                Contact the operator if you do not know your workspace password.
              </p>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <span
                  className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin"
                  aria-hidden
                />
                <span>Signing in…</span>
              </>
            ) : (
              <span>Sign in to {selected}</span>
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
