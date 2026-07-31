"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api, ApiError } from "@/lib/api";
import { WORKSPACES, type Workspace } from "@pagaska/shared";

export default function WorkspaceSwitcherPage() {
  const { workspace, loading, login, logout } = useAuth();
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
    api
      .listWorkspaces()
      .then((r) => {
        if (cancelled) return;
        if (Array.isArray(r.workspaces) && r.workspaces.length > 0) {
          setKnownWorkspaces(r.workspaces as readonly Workspace[]);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? `Could not load workspaces (${err.code}). Using cached list.`
            : "Could not load workspaces. Using cached list."
        );
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-xl font-semibold">Choose a workspace</h1>
        <p className="text-sm text-slate-500 mb-4">
          Each workspace has its own isolated Drive folder.
        </p>

        {error && (
          <p className="mb-3 text-xs text-slate-500" role="status">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {knownWorkspaces.map((w) => (
            <button
              key={w}
              onClick={() => router.push("/")}
              className={`rounded-xl border p-4 text-left transition ${
                workspace === w
                  ? "border-brand-500 bg-brand-50"
                  : "border-slate-200 hover:border-slate-300"
              }`}
              disabled={fetching && !workspace}
            >
              <div className="text-lg font-semibold capitalize">{w}</div>
              <div className="text-xs text-slate-500">
                {workspace === w ? "current" : "sign in to switch"}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={logout} className="btn-ghost text-sm">
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}
