"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { createEngine, toUploadSources } from "@/lib/engine";
import type { ProgressSnapshot, UploadFileSnapshot, UploadEngine } from "@pagaska/upload-engine";

export default function UploadPage() {
  const { workspace, loading } = useAuth();
  const router = useRouter();
  const engineRef = useRef<UploadEngine | null>(null);
  const [snapshot, setSnapshot] = useState<ProgressSnapshot | null>(null);
  const [files, setFiles] = useState<UploadFileSnapshot[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !workspace) router.replace("/");
  }, [loading, workspace, router]);

  // Construct one engine per page-mount; tear it down on unmount.
  useEffect(() => {
    if (!workspace) return;
    const engine = createEngine({
      parentId: folderId,
      onProgress: (snap) => setSnapshot(snap),
      onFileStateChange: (file) => {
        setFiles((prev) => {
          const idx = prev.findIndex((f) => f.id === file.id);
          if (idx === -1) return [...prev, file];
          const next = prev.slice();
          next[idx] = file;
          return next;
        });
      },
    });
    engineRef.current = engine;
    return () => {
      void engine.stop();
      engineRef.current = null;
    };
  }, [workspace, folderId]);

  const handleFiles = useCallback(
    async (rawFiles: File[]) => {
      if (!engineRef.current) return;
      setError(null);
      const sources = toUploadSources(rawFiles);
      engineRef.current.addFiles(sources);
      engineRef.current.start();
    },
    []
  );

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    void handleFiles(Array.from(list));
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const items = e.dataTransfer.items;
    const files: File[] = [];
    if (items && items.length && "webkitGetAsEntry" in items[0]) {
      const entries: PagaskaFsEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.() as PagaskaFsEntry | null;
        if (entry) entries.push(entry);
      }
      collectEntries(entries, files).then(() => void handleFiles(files));
    } else {
      void handleFiles(Array.from(e.dataTransfer.files));
    }
  }

  if (!workspace) return null;

  return (
    <main className="min-h-screen p-6 max-w-5xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <h1 className="text-xl font-semibold">Upload to {workspace}'s drive</h1>
        <div className="flex gap-2">
          <Link className="btn-ghost" href="/drive">Back to drive</Link>
        </div>
      </header>

      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      <section
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`card p-8 text-center transition ${dragOver ? "ring-2 ring-brand-500" : ""}`}
      >
        <p className="text-slate-600 mb-3">Drag &amp; drop files or a folder here</p>
        <p className="text-xs text-slate-400 mb-4">— or —</p>
        <div className="flex justify-center gap-2 flex-wrap">
          <label className="btn-primary cursor-pointer">
            Choose files
            <input type="file" multiple className="hidden" onChange={onFileInput} />
          </label>
          <label className="btn-ghost cursor-pointer">
            Choose folder
            <input
              type="file"
              multiple
              // @ts-expect-error — non-standard but supported by all evergreen browsers
              webkitdirectory=""
              directory=""
              className="hidden"
              onChange={onFileInput}
            />
          </label>
        </div>
      </section>

      {snapshot && (
        <section className="card p-4 mt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold">
              {snapshot.totalBytes === 0
                ? "No uploads yet"
                : `Uploading ${formatSize(snapshot.uploadedBytes)} / ${formatSize(snapshot.totalBytes)}`}
            </div>
            <div className="text-sm text-slate-500">
              {snapshot.uploadedFiles} / {snapshot.totalFiles} files · {formatSize(snapshot.overallSpeedBps)}/s
              {snapshot.remainingSeconds != null && (
                <> · remaining {Math.ceil(snapshot.remainingSeconds / 60)}m {Math.round(snapshot.remainingSeconds % 60)}s</>
              )}
            </div>
          </div>
          <div className="bar"><div style={{ width: `${(snapshot.fraction * 100).toFixed(1)}%` }} /></div>
          <div className="text-xs text-slate-500 mt-2 flex flex-wrap gap-3">
            <span>queued: {snapshot.queuedFiles}</span>
            <span>retrying: {snapshot.retryingFiles}</span>
            <span>failed: {snapshot.failedFiles}</span>
            <span>completed: {snapshot.uploadedFiles}</span>
          </div>
        </section>
      )}

      {files.length > 0 && (
        <section className="card mt-4 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left text-slate-600">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2 w-1/3">Progress</th>
                <th className="px-4 py-2">State</th>
                <th className="px-4 py-2 w-1"></th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => {
                const pct = f.size > 0 ? (f.bytesUploaded / f.size) * 100 : 0;
                return (
                  <tr key={f.id} className="border-t border-slate-100">
                    <td className="px-4 py-2">
                      <div className="truncate max-w-xs">{f.relativePath}</div>
                      <div className="text-xs text-slate-400">{formatSize(f.bytesUploaded)} / {formatSize(f.size)}</div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="bar"><div style={{ width: `${pct.toFixed(1)}%` }} /></div>
                      <div className="text-xs text-slate-400 mt-1">{formatSize(f.speedBps)}/s</div>
                    </td>
                    <td className="px-4 py-2 capitalize">{f.state}</td>
                    <td className="px-4 py-2 text-right space-x-1">
                      {f.state === "uploading" || f.state === "retrying" ? (
                        <button className="btn-ghost text-xs" onClick={() => engineRef.current?.pauseFile(f.id)}>pause</button>
                      ) : f.state === "paused" ? (
                        <button className="btn-ghost text-xs" onClick={() => engineRef.current?.resumeFile(f.id)}>resume</button>
                      ) : null}
                      {f.state === "failed" && (
                        <button className="btn-ghost text-xs" onClick={() => engineRef.current?.retryFile(f.id)}>retry</button>
                      )}
                      {(f.state === "uploading" || f.state === "queued" || f.state === "paused" || f.state === "failed") && (
                        <button className="btn-ghost text-xs text-red-600" onClick={() => engineRef.current?.cancelFile(f.id)}>cancel</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <div className="mt-4 flex gap-2">
        <button className="btn-ghost" onClick={() => engineRef.current?.retryAllFailed()}>Retry all failed</button>
        <button className="btn-ghost" onClick={() => engineRef.current?.pauseAll()}>Pause all</button>
        <button className="btn-ghost" onClick={() => engineRef.current?.resumeAll()}>Resume all</button>
        <button className="btn-ghost text-red-600" onClick={() => engineRef.current?.cancelAll()}>Cancel all</button>
      </div>
    </main>
  );
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// Recursively walk a DataTransferItemList and collect all files.
interface PagaskaFsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  createReader(): { readEntries(cb: (entries: PagaskaFsEntry[]) => void): void };
  file(cb: (f: File) => void): void;
}

function collectEntries(entries: PagaskaFsEntry[], out: File[]): Promise<void> {
  return Promise.all(
    entries.map(
      (entry) =>
        new Promise<void>((resolve) => {
          if (entry.isFile) {
            entry.file((f) => {
              // Preserve folder path by overwriting webkitRelativePath.
              try {
                Object.defineProperty(f, "webkitRelativePath", { value: entry.fullPath.replace(/^\//, "") });
              } catch {
                /* readonly on some engines */
              }
              out.push(f);
              resolve();
            });
          } else if (entry.isDirectory) {
            const reader = entry.createReader();
            const all: PagaskaFsEntry[] = [];
            const read = () => {
              reader.readEntries((batch) => {
                if (batch.length === 0) {
                  collectEntries(all, out).then(resolve);
                } else {
                  all.push(...batch);
                  read();
                }
              });
            };
            read();
          } else {
            resolve();
          }
        })
    )
  ).then(() => undefined);
}
