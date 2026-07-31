"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api, ApiError } from "@/lib/api";
import { WORKSPACES, type Workspace } from "@pagaska/shared";
import { Loader2, Eye, EyeOff, HardDrive, TriangleAlert } from "lucide-react";

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

  const [knownWorkspaces, setKnownWorkspaces] = useState<readonly Workspace[]>(WORKSPACES);
  useEffect(() => {
    let cancelled = false;
    api.listWorkspaces()
      .then((r) => { if (cancelled) return; if (Array.isArray(r.workspaces) && r.workspaces.length > 0) setKnownWorkspaces(r.workspaces as readonly Workspace[]); })
      .catch(() => { /* keep static fallback */ });
    return () => { cancelled = true; };
  }, []);

  const passwordEmpty = password.length === 0;
  const showValidation = touched && passwordEmpty;
  const canSubmit = useMemo(() => !busy && !loading && password.length >= 1, [busy, loading, password.length]);

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
          case "INVALID_CREDENTIALS": setError("The password you entered is incorrect for this workspace."); break;
          case "CONFIG_ERROR": setError("This workspace is not yet configured on the server."); break;
          case "INVALID_LOGIN_PAYLOAD": setError("Please select a workspace and enter a password."); break;
          default: setError(err.message);
        }
      } else {
        setError(err instanceof Error ? err.message : "Login failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
      <div className="w-full max-w-sm">
        {/* Brand mark */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="rounded-2xl bg-brand-500 p-2.5 shadow-md">
            <HardDrive className="h-6 w-6 text-white" />
          </div>
          <span className="text-xl font-bold text-slate-900 tracking-tight">Pagaska Drive</span>
        </div>

        <div className="card p-6">
          <h1 className="text-base font-semibold text-slate-900 mb-0.5">Sign in</h1>
          <p className="text-sm text-slate-500 mb-5">
            {loading ? "Loading your session…" : "Choose a workspace and enter your password."}
          </p>

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {/* Workspace selector */}
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
                    className={`rounded-xl border px-3 py-2.5 text-sm font-medium capitalize transition-all duration-150 ${
                      selected === w
                        ? "border-brand-400 bg-brand-50 text-brand-700 shadow-sm ring-1 ring-brand-200"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>

            {/* Password field */}
            <div>
              <label className="label" htmlFor="password">Password</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => setTouched(true)}
                  className="input pr-10"
                  autoComplete="current-password"
                  placeholder="Workspace password"
                  aria-invalid={showValidation || undefined}
                  aria-describedby="password-help"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600 transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {showValidation ? (
                <p id="password-help" className="mt-1.5 text-xs text-red-600">Password is required.</p>
              ) : (
                <p id="password-help" className="mt-1.5 text-xs text-slate-400">
                  Contact the operator if you don't know your workspace password.
                </p>
              )}
            </div>

            {/* Error */}
            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <button type="submit" disabled={!canSubmit} className="btn-primary w-full mt-2">
              {busy ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Signing in…</>
              ) : (
                `Sign in to ${selected}`
              )}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
