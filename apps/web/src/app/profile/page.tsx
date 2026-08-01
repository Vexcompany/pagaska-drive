"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api, ApiError } from "@/lib/api";
import { WORKSPACES, type Workspace } from "@pagaska/shared";
import { ArrowLeft, Check, LogOut, HardDrive } from "lucide-react";
import Link from "next/link";

export default function WorkspaceSwitcherPage() {
  const { workspace, loading, switchWorkspace, logout } = useAuth();
  const router = useRouter();
  const [knownWorkspaces, setKnownWorkspaces] = useState<readonly Workspace[]>(WORKSPACES);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !workspace) router.replace("/");
  }, [loading, workspace, router]);

  useEffect(() => {
    let cancelled = false;
    setFetching(true);
    api.listWorkspaces()
      .then((r) => { if (cancelled) return; if (Array.isArray(r.workspaces) && r.workspaces.length > 0) setKnownWorkspaces(r.workspaces as readonly Workspace[]); })
      .catch((err) => { if (cancelled) return; setError(err instanceof ApiError ? `Could not load workspaces (${err.code}).` : "Could not load workspaces."); })
      .finally(() => { if (!cancelled) setFetching(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Back */}
        <Link
          href="/drive"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 mb-5 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to drive
        </Link>

        <div className="card p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-xl bg-brand-500 p-2 shadow-sm">
              <HardDrive className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-slate-900 text-base">Workspaces</h1>
              <p className="text-xs text-slate-400">Each workspace has its own isolated Drive folder.</p>
            </div>
          </div>

          {error && (
            <p className="mb-4 text-xs text-slate-400 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100" role="status">
              {error} Using cached list.
            </p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {knownWorkspaces.map((w) => {
              const isCurrent = workspace === w;
              return (
                <button
                  key={w}
                  onClick={() => {
                    if (isCurrent) return;
                    switchWorkspace(w);
                  }}
                  className={`relative rounded-2xl border p-4 text-left transition-all duration-150 ${
                    isCurrent
                      ? "border-brand-300 bg-brand-50 ring-1 ring-brand-200"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                  disabled={fetching && !workspace}
                >
                  {isCurrent && (
                    <div className="absolute top-2.5 right-2.5 rounded-full bg-brand-500 p-0.5">
                      <Check className="h-2.5 w-2.5 text-white" />
                    </div>
                  )}
                  <div className={`text-sm font-semibold capitalize ${isCurrent ? "text-brand-700" : "text-slate-800"}`}>
                    {w}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {isCurrent ? "current" : "switch workspace"}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-5 pt-4 border-t border-slate-100 flex justify-end">
            <button
              onClick={logout}
              className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-xl px-3 py-2 transition-all"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
