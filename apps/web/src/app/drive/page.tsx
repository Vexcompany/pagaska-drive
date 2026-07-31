"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import type { DriveFile, ListFilesResponse } from "@pagaska/shared";

export default function DrivePage() {
  const { workspace, loading, logout } = useAuth();
  const router = useRouter();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [data, setData] = useState<ListFilesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [renaming, setRenaming] = useState<DriveFile | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [loadingFiles, setLoadingFiles] = useState(false);

  const refresh = useCallback(async (id: string | null) => {
    setLoadingFiles(true);
    try {
      const next = await api.listFiles(id);
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files.");
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && !workspace) router.replace("/");
  }, [loading, workspace, router]);

  useEffect(() => {
    if (workspace) void refresh(folderId);
  }, [workspace, folderId, refresh]);

  if (!workspace) return null;

  async function createFolder() {
    if (!newFolderName.trim()) return;
    await api.createFolder({ name: newFolderName.trim(), parentId: folderId });
    setNewFolderName("");
    void refresh(folderId);
  }

  async function deleteOne(id: string) {
    if (!confirm("Delete this item? This cannot be undone.")) return;
    await api.deleteFile(id);
    void refresh(folderId);
  }

  async function submitRename() {
    if (!renaming || !renameValue.trim()) return;
    await api.rename({ fileId: renaming.id, name: renameValue.trim() });
    setRenaming(null);
    setRenameValue("");
    void refresh(folderId);
  }

  return (
    <main className="min-h-screen p-6 max-w-6xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">Pagaska Drive <span className="text-slate-400">/ {workspace}</span></h1>
          <nav className="text-sm text-slate-500 mt-1">
            <Link className="hover:underline" href="/drive">root</Link>
            {data?.breadcrumb.map((c) => (
              <span key={c.id}> / <button onClick={() => setFolderId(c.id)} className="hover:underline">{c.name}</button></span>
            ))}
          </nav>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn-ghost" href="/upload">Upload</Link>
          <Link className="btn-ghost" href="/profile">Switch workspace</Link>
          <button onClick={logout} className="btn-ghost">Sign out</button>
        </div>
      </header>

      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      <section className="card p-4 mb-4">
        <div className="flex gap-2">
          <input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="New folder name"
            className="input"
          />
          <button onClick={createFolder} className="btn-primary">Create folder</button>
        </div>
      </section>

      <section className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-slate-600">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Size</th>
              <th className="px-4 py-2">Modified</th>
              <th className="px-4 py-2 w-1"></th>
            </tr>
          </thead>
          <tbody>
            {data?.folders.map((f) => (
              <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2">
                  <button onClick={() => setFolderId(f.id)} className="text-brand-600 hover:underline">
                    📁 {f.name}
                  </button>
                </td>
                <td className="px-4 py-2">folder</td>
                <td className="px-4 py-2">—</td>
                <td className="px-4 py-2">{f.modifiedTime?.replace("T", " ").slice(0, 19) ?? "—"}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => { setRenaming(f); setRenameValue(f.name); }} className="btn-ghost text-xs">rename</button>
                  <button onClick={() => deleteOne(f.id)} className="btn-ghost text-xs text-red-600">delete</button>
                </td>
              </tr>
            ))}
            {data?.files.map((f) => (
              <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link className="text-brand-600 hover:underline" href={`/preview?id=${f.id}`}>
                    📄 {f.name}
                  </Link>
                </td>
                <td className="px-4 py-2">{f.mimeType.split("/").pop()}</td>
                <td className="px-4 py-2">{formatSize(f.size)}</td>
                <td className="px-4 py-2">{f.modifiedTime?.replace("T", " ").slice(0, 19) ?? "—"}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => { setRenaming(f); setRenameValue(f.name); }} className="btn-ghost text-xs">rename</button>
                  <button onClick={() => deleteOne(f.id)} className="btn-ghost text-xs text-red-600">delete</button>
                </td>
              </tr>
            ))}
            {data && data.files.length === 0 && data.folders.length === 0 && !loadingFiles && (
              <tr><td colSpan={5} className="text-center text-slate-400 py-8">This folder is empty.</td></tr>
            )}
            {loadingFiles && !data && (
              <tr>
                <td colSpan={5} className="text-center text-slate-400 py-8">
                  <span className="inline-block h-3 w-3 rounded-full border-2 border-slate-300 border-t-brand-500 animate-spin align-middle mr-2" />
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {renaming && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6" role="dialog">
          <div className="card w-full max-w-sm p-4">
            <h2 className="font-semibold mb-2">Rename</h2>
            <input
              className="input mb-3"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRenaming(null)} className="btn-ghost">Cancel</button>
              <button onClick={submitRename} className="btn-primary">Save</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function formatSize(bytes: string | number | null): string {
  if (bytes == null) return "—";
  const n = typeof bytes === "string" ? Number(bytes) : bytes;
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
