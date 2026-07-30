"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { PROFILES, type Profile } from "@pagaska/shared";

export default function ProfilePage() {
  const { profile, loading, login, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !profile) router.replace("/");
  }, [loading, profile, router]);

  async function pick(p: Profile) {
    await login(p, "pagaska");
    router.replace("/drive");
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-xl font-semibold">Choose a profile</h1>
        <p className="text-sm text-slate-500 mb-4">Each profile has its own isolated Drive folder.</p>
        <div className="grid grid-cols-2 gap-3">
          {PROFILES.map((p) => (
            <button
              key={p}
              onClick={() => pick(p)}
              className={`rounded-xl border p-4 text-left transition ${
                profile === p
                  ? "border-brand-500 bg-brand-50"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="text-lg font-semibold capitalize">{p}</div>
              <div className="text-xs text-slate-500">
                {profile === p ? "current" : "switch to"}
              </div>
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={logout} className="btn-ghost text-sm">Sign out</button>
        </div>
      </div>
    </main>
  );
}
