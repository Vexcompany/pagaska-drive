"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Upload,
  Folder,
  Pause,
  Play,
  RotateCcw,
  X,
  CloudUpload,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { createEngine, toUploadSources } from "@/lib/engine";
import { Button, Card, StatusBadge, ProgressBar, ErrorBanner } from "@/components/ui";
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
    return () => { void engine.stop(); engineRef.current = null; };
  }, [workspace, folderId]);

  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.totalFiles > 0 && snapshot.uploadedFiles === snapshot.totalFiles) {
      router.push("/drive");
    }
  }, [snapshot, router]);

  const handleFiles = useCallback(async (rawFiles: File[]) => {
    if (!engineRef.current) return;
    setError(null);
    const sources = toUploadSources(rawFiles);
    engineRef.current.addFiles(sources);
    engineRef.current.start();
  }, []);

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

  const pct = snapshot ? snapshot.fraction * 100 : 0;
  const isActive = files.some((f) => f.state === "uploading" || f.state === "queued");

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link
            href="/drive"
            className="inline-flex items-center gap-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all"
          >
            <ArrowLeft className="h-4 w-4" />
            Drive
          </Link>
          <div className="h-4 w-px bg-slate-200" />
          <h1 className="text-sm font-semibold text-slate-900">Upload files</h1>
          <span className="text-xs text-slate-400 hidden sm:inline">to {workspace}</span>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`rounded-2xl border-2 border-dashed p-12 text-center transition-all duration-150 ${
            dragOver
              ? "border-brand-400 bg-brand-50 scale-[1.01]"
              : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <div className={`inline-flex rounded-2xl p-4 mb-4 transition-colors ${dragOver ? "bg-brand-100" : "bg-slate-100"}`}>
            <CloudUpload className={`h-8 w-8 ${dragOver ? "text-brand-500" : "text-slate-400"}`} />
          </div>
          <p className="text-slate-700 font-medium mb-1">
            {dragOver ? "Drop to upload" : "Drag & drop files here"}
          </p>
          <p className="text-sm text-slate-400 mb-6">or choose files from your device</p>
          <div className="flex justify-center gap-3 flex-wrap">
            <label className="inline-flex items-center gap-1.5 bg-brand-500 text-white hover:bg-brand-600 rounded-xl px-4 py-2 text-sm font-medium cursor-pointer transition-all shadow-sm">
              <Upload className="h-4 w-4" />
              Choose files
              <input type="file" multiple className="hidden" onChange={onFileInput} />
            </label>
            <label className="inline-flex items-center gap-1.5 text-slate-700 hover:bg-slate-100 border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium cursor-pointer transition-all">
              <Folder className="h-4 w-4 text-slate-400" />
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
        </div>

        {/* Overall progress */}
        {snapshot && snapshot.totalFiles > 0 && (
          <Card className="p-5 animate-pop-in">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  {snapshot.uploadedFiles === snapshot.totalFiles ? (
                    <span className="flex items-center gap-1.5 text-emerald-600">
                      <CheckCircle2 className="h-4 w-4" />
                      Upload complete
                    </span>
                  ) : (
                    `Uploading ${snapshot.uploadedFiles} / ${snapshot.totalFiles} files`
                  )}
                </div>
                <div className="text-xs text-slate-400 mt-0.5 tabular-nums">
                  {formatSize(snapshot.uploadedBytes)} / {formatSize(snapshot.totalBytes)}
                  {snapshot.overallSpeedBps > 0 && ` · ${formatSize(snapshot.overallSpeedBps)}/s`}
                  {snapshot.remainingSeconds != null && snapshot.remainingSeconds > 0 && (
                    <> · {Math.ceil(snapshot.remainingSeconds / 60)}m {Math.round(snapshot.remainingSeconds % 60)}s left</>
                  )}
                </div>
              </div>
              <div className="text-lg font-semibold tabular-nums text-slate-700">
                {pct.toFixed(0)}%
              </div>
            </div>
            <ProgressBar value={pct} />

            {/* Status pills */}
            <div className="flex flex-wrap gap-2 mt-3">
              {snapshot.queuedFiles > 0 && (
                <span className="text-xs text-slate-500 bg-slate-100 rounded-full px-2.5 py-0.5">
                  {snapshot.queuedFiles} queued
                </span>
              )}
              {snapshot.retryingFiles > 0 && (
                <span className="text-xs text-amber-700 bg-amber-50 rounded-full px-2.5 py-0.5">
                  {snapshot.retryingFiles} retrying
                </span>
              )}
              {snapshot.failedFiles > 0 && (
                <span className="text-xs text-red-700 bg-red-50 rounded-full px-2.5 py-0.5 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {snapshot.failedFiles} failed
                </span>
              )}
              {snapshot.uploadedFiles > 0 && (
                <span className="text-xs text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-0.5">
                  {snapshot.uploadedFiles} done
                </span>
              )}
            </div>
          </Card>
        )}

        {/* Bulk controls */}
        {files.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            <Button variant="ghost" size="sm" onClick={() => engineRef.current?.retryAllFailed()}>
              <RotateCcw className="h-3.5 w-3.5" /> Retry all failed
            </Button>
            <Button variant="ghost" size="sm" onClick={() => engineRef.current?.pauseAll()}>
              <Pause className="h-3.5 w-3.5" /> Pause all
            </Button>
            <Button variant="ghost" size="sm" onClick={() => engineRef.current?.resumeAll()}>
              <Play className="h-3.5 w-3.5" /> Resume all
            </Button>
            <Button variant="danger" size="sm" onClick={() => engineRef.current?.cancelAll()}>
              <X className="h-3.5 w-3.5" /> Cancel all
            </Button>
          </div>
        )}

        {/* Per-file cards */}
        {files.length > 0 && (
          <Card className="overflow-hidden divide-y divide-slate-50">
            {files.map((f) => {
              const pct = f.size > 0 ? (f.bytesUploaded / f.size) * 100 : 0;
              const isUploading = f.state === "uploading" || f.state === "retrying";
              return (
                <div key={f.id} className="px-4 py-3 flex items-start gap-4">
                  {/* File info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-medium text-slate-800 truncate">{f.relativePath}</span>
                      <StatusBadge state={f.state} />
                    </div>

                    {/* Progress bar */}
                    {(isUploading || f.state === "paused") && (
                      <div className="mb-1">
                        <ProgressBar value={pct} />
                      </div>
                    )}

                    {/* Stats row */}
                    <div className="flex items-center gap-3 text-xs text-slate-400 tabular-nums">
                      <span>{formatSize(f.bytesUploaded)} / {formatSize(f.size)}</span>
                      {f.speedBps > 0 && <span>{formatSize(f.speedBps)}/s</span>}
                      {f.state === "retrying" && (
                        <span className="text-amber-600">attempt {(f.attempt ?? 0) + 1}</span>
                      )}
                      {f.state === "failed" && f.errorMessage && (
                        <span className="text-red-500 truncate max-w-xs" title={f.errorMessage}>
                          {f.errorMessage}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Per-file actions */}
                  <div className="flex items-center gap-1 shrink-0 mt-0.5">
                    {isUploading ? (
                      <button
                        className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
                        onClick={() => engineRef.current?.pauseFile(f.id)}
                        title="Pause"
                      >
                        <Pause className="h-3.5 w-3.5" />
                      </button>
                    ) : f.state === "paused" ? (
                      <button
                        className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
                        onClick={() => engineRef.current?.resumeFile(f.id)}
                        title="Resume"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    {f.state === "failed" && (
                      <button
                        className="rounded-lg p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-all"
                        onClick={() => engineRef.current?.retryFile(f.id)}
                        title="Retry"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {(f.state === "uploading" || f.state === "queued" || f.state === "paused" || f.state === "failed") && (
                      <button
                        className="rounded-lg p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all"
                        onClick={() => engineRef.current?.cancelFile(f.id)}
                        title="Cancel"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </Card>
        )}
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
              try {
                Object.defineProperty(f, "webkitRelativePath", { value: entry.fullPath.replace(/^\//, "") });
              } catch { /* readonly on some engines */ }
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
