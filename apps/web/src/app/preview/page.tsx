"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  House,
  Image as ImageIcon,
  Video,
  Music,
  File,
  TriangleAlert,
  Eye,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api, authHeaders } from "@/lib/api";
import { Button, Card, Skeleton, ErrorBanner } from "@/components/ui";
import type { DriveFile, ListFilesResponse, PreviewResponse } from "@pagaska/shared";

export default function PreviewPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand-400" />
      </main>
    }>
      <PreviewInner />
    </Suspense>
  );
}

function PreviewInner() {
  const { workspace, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id");
  const folderId = useMemo(() => params.get("folderId") ?? null, [params]);

  const [data, setData] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { blobUrl: contentUrl, error: contentError, loading: contentLoading } = useAuthedBlob(data?.contentUrl ?? null);

  // ── Folder context: siblings for prev/next & breadcrumb ──────────────────
  const [folderData, setFolderData] = useState<ListFilesResponse | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.listFiles(folderId)
      .then((res) => { if (alive) setFolderData(res); })
      .catch((err) => { if (alive) setFolderError(err instanceof Error ? err.message : "Failed to load folder."); });
    return () => { alive = false; };
  }, [folderId]);

  /** All non-folder files in the current folder, sorted by name (same as drive default). */
  const siblings = useMemo<DriveFile[]>(() => {
    if (!folderData) return [];
    return [...folderData.files].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
    );
  }, [folderData]);

  const currentIndex = useMemo(() => siblings.findIndex((f) => f.id === id), [siblings, id]);
  const prevItem = currentIndex > 0 ? siblings[currentIndex - 1] : null;
  const nextItem = currentIndex >= 0 && currentIndex < siblings.length - 1 ? siblings[currentIndex + 1] : null;

  // ── Navigation helpers ──────────────────────────────────────────────────

  /** Navigate to another file in the same folder. */
  const navigateToSibling = useCallback((fileId: string) => {
    setData(null);
    setError(null);
    const folderParam = folderId ? `&folderId=${encodeURIComponent(folderId)}` : "";
    router.push(`/preview?id=${encodeURIComponent(fileId)}${folderParam}`);
  }, [folderId, router]);

  /** Go back to the drive page, preserving the folder context. */
  const goBackToDrive = useCallback(() => {
    router.push(folderId ? `/drive?folderId=${encodeURIComponent(folderId)}` : "/drive");
  }, [folderId, router]);

  // ── Auth guard ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!loading && !workspace) router.replace("/");
  }, [loading, workspace, router]);

  // ── Fetch preview data when id changes ──────────────────────────────────

  useEffect(() => {
    if (!id) return;
    setData(null);
    setError(null);
    api.preview(id).then(setData).catch((err) => setError(err instanceof Error ? err.message : "Failed to load file."));
  }, [id]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't capture when typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.key === "ArrowLeft" && prevItem) {
      e.preventDefault();
      navigateToSibling(prevItem.id);
    } else if (e.key === "ArrowRight" && nextItem) {
      e.preventDefault();
      navigateToSibling(nextItem.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      goBackToDrive();
    }
  }, [prevItem, nextItem, navigateToSibling, goBackToDrive]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // ── Empty state ─────────────────────────────────────────────────────────

  if (!id) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="max-w-sm w-full p-10 text-center">
          <div className="rounded-2xl bg-slate-100 p-5 inline-flex mb-4">
            <Eye className="h-8 w-8 text-slate-400" />
          </div>
          <p className="font-semibold text-slate-700 mb-1">Nothing to preview</p>
          <p className="text-sm text-slate-400 mb-6">No file was selected. Go back to your drive and pick one.</p>
          <Link href="/drive" className="inline-flex items-center gap-1.5 text-slate-700 hover:bg-slate-100 rounded-xl px-4 py-2 text-sm font-medium transition-all border border-slate-200">
            <ArrowLeft className="h-4 w-4" /> Back to drive
          </Link>
        </Card>
      </main>
    );
  }

  if (!workspace) return null;

  const hasContent = !!(
    isImage(data?.mimeType ?? "") ||
    isVideo(data?.mimeType ?? "") ||
    isAudio(data?.mimeType ?? "") ||
    isPdf(data?.mimeType ?? "") ||
    isText(data?.mimeType ?? "")
  );

  // Build breadcrumb from folder data + current file name
  const breadcrumb = folderData?.breadcrumb ?? [];

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          {/* Breadcrumb: Home > Folder > … > Filename */}
          <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto">
            <button
              onClick={goBackToDrive}
              className="flex items-center gap-1.5 text-brand-600 hover:text-brand-700 font-semibold shrink-0"
            >
              <House className="h-4 w-4" />
              <span className="hidden sm:inline text-sm">Drive</span>
            </button>
            {breadcrumb.map((c) => (
              <span key={c.id} className="flex items-center gap-1 min-w-0 shrink-0">
                <ChevronRight className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                <button
                  onClick={goBackToDrive}
                  className="text-sm text-slate-600 hover:text-slate-900 truncate max-w-[8rem]"
                >
                  {c.name}
                </button>
              </span>
            ))}
            {/* Current file name in breadcrumb */}
            <span className="flex items-center gap-1 min-w-0 shrink-0">
              <ChevronRight className="h-3.5 w-3.5 text-slate-300 shrink-0" />
              <span className="text-sm text-slate-900 font-medium truncate max-w-[12rem]">
                {data?.name ?? "…"}
              </span>
            </span>
          </div>

          {/* File metadata */}
          {data && (
            <span className="text-xs text-slate-400 shrink-0 hidden md:inline">
              {data.mimeType} · {formatSize(data.size)}
            </span>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {contentUrl && data && (
              <a
                href={contentUrl}
                download={data.name}
                className="inline-flex items-center gap-1.5 bg-brand-500 text-white hover:bg-brand-600 rounded-lg px-3 py-1.5 text-sm font-medium transition-all shadow-sm"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Download</span>
              </a>
            )}
            {data?.webViewLink && !data.trashed && (
              <a
                href={data.webViewLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-lg px-3 py-1.5 text-sm font-medium transition-all"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Open in Drive</span>
              </a>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {error && <ErrorBanner message={error} />}
        {contentError && <ErrorBanner message={`Content failed to load: ${contentError}`} />}
        {folderError && <ErrorBanner message={folderError} />}

        {/* Trash warning */}
        {data?.trashed && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-4">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>This item is currently in Trash. Sharing and public links are disabled.</span>
          </div>
        )}

        {/* Skeleton while loading metadata */}
        {!data && !error && (
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-xl" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
            <Skeleton className="h-96 rounded-2xl" />
          </Card>
        )}

        {data && (
          <Card className="overflow-hidden relative">
            {/* Content area */}
            <div className="p-6">
              {/* Loading blob */}
              {contentLoading && hasContent && (
                <div className="flex items-center justify-center h-64 text-slate-400 gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
                  <span className="text-sm">Loading preview…</span>
                </div>
              )}

              {isImage(data.mimeType) && contentUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={contentUrl}
                  alt={data.name}
                  className="max-w-full rounded-2xl mx-auto shadow-sm"
                />
              )}
              {isVideo(data.mimeType) && contentUrl && (
                <video
                  src={contentUrl}
                  controls
                  className="max-w-full rounded-2xl mx-auto shadow-sm w-full"
                />
              )}
              {isAudio(data.mimeType) && contentUrl && (
                <div className="flex flex-col items-center gap-4 py-6">
                  <div className="rounded-2xl bg-slate-100 p-6">
                    <Music className="h-12 w-12 text-slate-400" />
                  </div>
                  <audio src={contentUrl} controls className="w-full max-w-lg" />
                </div>
              )}
              {isPdf(data.mimeType) && contentUrl && (
                <iframe
                  src={contentUrl}
                  title={data.name}
                  className="w-full h-[75vh] rounded-2xl border border-slate-100"
                />
              )}
              {isText(data.mimeType) && contentUrl && (
                <TextPreview blobUrl={contentUrl} />
              )}
              {data.thumbnailUrl && !isImage(data.mimeType) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.thumbnailUrl} alt="" className="max-w-sm rounded-2xl mb-4 shadow-sm" />
              )}
              {!hasContent && !contentLoading && (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                  <div className="rounded-2xl bg-slate-100 p-5">
                    <File className="h-8 w-8 text-slate-400" />
                  </div>
                  <p className="text-sm text-slate-500 font-medium">No preview available for this file type</p>
                  <p className="text-xs text-slate-400">Use the download button above to view this file.</p>
                </div>
              )}
            </div>

            {/* Prev / Next navigation overlay */}
            {(prevItem || nextItem) && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/50">
                <button
                  onClick={() => prevItem && navigateToSibling(prevItem.id)}
                  disabled={!prevItem}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg px-3 py-1.5 transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  title={prevItem ? `Previous: ${prevItem.name}` : undefined}
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="hidden sm:inline truncate max-w-[12rem]">{prevItem?.name ?? "Previous"}</span>
                </button>
                <span className="text-xs text-slate-400 tabular-nums">
                  {currentIndex >= 0 ? `${currentIndex + 1} / ${siblings.length}` : ""}
                </span>
                <button
                  onClick={() => nextItem && navigateToSibling(nextItem.id)}
                  disabled={!nextItem}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg px-3 py-1.5 transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  title={nextItem ? `Next: ${nextItem.name}` : undefined}
                >
                  <span className="hidden sm:inline truncate max-w-[12rem]">{nextItem?.name ?? "Next"}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </Card>
        )}

        {/* Error screen */}
        {error && !data && (
          <Card className="p-10 text-center">
            <div className="rounded-2xl bg-red-50 p-5 inline-flex mb-4">
              <TriangleAlert className="h-8 w-8 text-red-400" />
            </div>
            <p className="font-semibold text-slate-700 mb-1">Preview failed</p>
            <p className="text-sm text-slate-400 mb-6">This file could not be loaded for preview.</p>
            <button
              onClick={goBackToDrive}
              className="inline-flex items-center gap-1.5 text-slate-700 hover:bg-slate-100 rounded-xl px-4 py-2 text-sm font-medium transition-all border border-slate-200"
            >
              <ArrowLeft className="h-4 w-4" /> Back to drive
            </button>
          </Card>
        )}
      </div>
    </main>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function PreviewFileIcon({ mime }: { mime: string }) {
  const cls = "h-5 w-5 shrink-0";
  if (mime.startsWith("image/")) return <ImageIcon className={`${cls} text-violet-400`} />;
  if (mime.startsWith("video/")) return <Video className={`${cls} text-red-400`} />;
  if (mime.startsWith("audio/")) return <Music className={`${cls} text-emerald-400`} />;
  if (mime === "application/pdf") return <FileText className={`${cls} text-red-400`} />;
  if (mime.startsWith("text/")) return <FileText className={`${cls} text-slate-400`} />;
  return <File className={`${cls} text-slate-400`} />;
}

function useAuthedBlob(url: string | null): { blobUrl: string | null; error: string | null; loading: boolean } {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!url) { setBlobUrl(null); setError(null); setLoading(false); return; }
    let alive = true;
    let objectUrl: string | null = null;
    setBlobUrl(null);
    setError(null);
    setLoading(true);
    fetch(url, { headers: authHeaders() })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.blob(); })
      .then((blob) => { if (!alive) return; objectUrl = URL.createObjectURL(blob); setBlobUrl(objectUrl); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : "Failed to load content."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return { blobUrl, error, loading };
}

function isImage(m: string): boolean { return m.startsWith("image/"); }
function isVideo(m: string): boolean { return m.startsWith("video/"); }
function isAudio(m: string): boolean { return m.startsWith("audio/"); }
function isPdf(m: string): boolean { return m === "application/pdf"; }
function isText(m: string): boolean {
  return m.startsWith("text/") || m === "application/json" || m === "application/xml" || m === "application/javascript";
}

function TextPreview({ blobUrl }: { blobUrl: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setText(null); setError(null);
    fetch(blobUrl)
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.text(); })
      .then((body) => { if (alive) setText(body); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : "Failed to load text."); });
    return () => { alive = false; };
  }, [blobUrl]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (text == null) return (
    <div className="flex items-center justify-center h-32 gap-2 text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin text-brand-400" />
      <span className="text-sm">Loading text…</span>
    </div>
  );
  return (
    <pre className="whitespace-pre-wrap break-words bg-slate-50 rounded-2xl p-4 max-h-[70vh] overflow-auto text-xs font-mono text-slate-700 leading-relaxed border border-slate-100">
      {text}
    </pre>
  );
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
