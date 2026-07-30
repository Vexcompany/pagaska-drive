"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { PROFILES, type Profile } from "@pagaska/shared";

export default function LoginPage() {
  const { profile, loading, login } = useAuth();
  const router = useRouter();
  const [selected, setSelected] = useState<Profile>("pagaska");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && profile) router.replace("/drive");
  }, [loading, profile, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(selected, passphrase);
      router.replace("/drive");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-2xl font-semibold mb-1">Pagaska Drive</h1>
        <p className="text-sm text-slate-500 mb-6">Sign in to your Pagaska profile.</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label">Profile</label>
            <div className="grid grid-cols-2 gap-2">
              {PROFILES.map((p) => (
                <button
                  type="button"
                  key={p}
                  onClick={() => setSelected(p)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium capitalize ${
                    selected === p
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="pass">Passphrase</label>
            <input
              id="pass"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="input"
              placeholder="pagaska"
              required
            />
            <p className="mt-1 text-xs text-slate-400">Demo passphrase: <code>pagaska</code></p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
