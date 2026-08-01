"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Upload,
  Folder,
  CloudUpload,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { addFilesToPanel } from "@/hooks/useUploadPanel";
import { Button, Card, ErrorBanner } from "@/components/ui";

/**
 * Upload page — now a simplified drop zone that adds files to the
 * floating upload panel. The user can browse away and uploads
 * continue in the background.
 */
export default function UploadPage() {
  const { workspace, loading } = useAuth();
  const router = useRouter();
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !workspace) router.replace("/");
  }, [loading, workspace, router]);

  function handleFiles(rawFiles: File[]) {
    if (rawFiles.length === 0) return;
    setError(null);
    addFilesToPanel(rawFiles, null);
    // Navigate back to drive — uploads continue in the panel
    router.push("/drive");
  }

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
    <main className="min-h-screen bg-slate-50">
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
          <p className="text-sm text-slate-400 mb-6">Uploads will continue in the background while you browse</p>
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
      </div>
    </main>
  );
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
