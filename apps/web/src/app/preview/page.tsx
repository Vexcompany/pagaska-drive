"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  File,
  TriangleAlert,
  Eye,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api, authHeaders } from "@/lib/api";
import { Button, Card, Skeleton, ErrorBanner } from "@/components/ui";
import type { PreviewResponse } from "@pagaska/shared";

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
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { blobUrl: contentUrl, error: contentError, loading: contentLoading } = useAuthedBlob(data?.contentUrl ?? null);

  useEffect(() => {
    if (!loading && !workspace) router.replace("/");
  }, [loading, workspace, router]);

  useEffect(() => {
    if (!id) return;
    api.preview(id).then(setData).catch((err) => setError(err instanceof Error ? err.message : "Failed to load file."));
  }, [id]);

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

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link
            href="/drive"
            className="inline-flex items-center gap-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Drive</span>
          </Link>

          <div className="h-4 w-px bg-slate-200" />

          <div className="flex-1 min-w-0">
            {data ? (
              <div className="flex items-center gap-2 min-w-0">
                <PreviewFileIcon mime={data.mimeType} />
                <span className="font-medium text-slate-900 truncate text-sm">{data.name}</span>
                <span className="text-xs text-slate-400 shrink-0 hidden sm:inline">
                  {data.mimeType} · {formatSize(data.size)}
                </span>
              </div>
            ) : (
              <Skeleton className="h-4 w-48" />
            )}
          </div>

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
            {data?.webViewLink && (
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
          <Card className="overflow-hidden">
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
            <Link
              href="/drive"
              className="inline-flex items-center gap-1.5 text-slate-700 hover:bg-slate-100 rounded-xl px-4 py-2 text-sm font-medium transition-all border border-slate-200"
            >
              <ArrowLeft className="h-4 w-4" /> Back to drive
            </Link>
          </Card>
        )}
      </div>
    </main>
  );
}

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

