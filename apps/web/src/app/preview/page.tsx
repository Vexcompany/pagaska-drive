"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import type { PreviewResponse } from "@pagaska/shared";

export default function PreviewPage() {
  return (
    <Suspense fallback={<main className="p-6 text-slate-400">Loading…</main>}>
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

  useEffect(() => {
    if (!loading && !workspace) router.replace("/");
  }, [loading, workspace, router]);

  useEffect(() => {
    if (!id) return;
    api.preview(id).then(setData).catch((err) => setError(err instanceof Error ? err.message : "Failed."));
  }, [id]);

  if (!id) return <main className="p-6">Missing id.</main>;
  if (!workspace) return null;

  return (
    <main className="min-h-screen p-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Preview</h1>
        <Link className="btn-ghost" href="/drive">Back to drive</Link>
      </header>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      {data ? (
        <div className="card p-6">
          <h2 className="text-lg font-semibold mb-2">{data.name}</h2>
          <p className="text-sm text-slate-500 mb-4">
            {data.mimeType} · {formatSize(data.size)}
          </p>
          {isImage(data.mimeType) && data.contentUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.contentUrl} alt={data.name} className="max-w-full rounded" />
          )}
          {isVideo(data.mimeType) && data.contentUrl && (
            <video src={data.contentUrl} controls className="max-w-full rounded" />
          )}
          {isAudio(data.mimeType) && data.contentUrl && (
            <audio src={data.contentUrl} controls className="w-full" />
          )}
          {isPdf(data.mimeType) && data.contentUrl && (
            <iframe src={data.contentUrl} title={data.name} className="w-full h-[70vh] rounded border border-slate-200" />
          )}
          {isText(data.mimeType) && data.contentUrl && (
            <TextPreview url={data.contentUrl} />
          )}
          {data.thumbnailUrl && !isImage(data.mimeType) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.thumbnailUrl} alt="" className="max-w-sm rounded mb-3" />
          )}
          {!isImage(data.mimeType) &&
            !isVideo(data.mimeType) &&
            !isAudio(data.mimeType) &&
            !isPdf(data.mimeType) &&
            !isText(data.mimeType) && (
              <p className="text-slate-500">No inline preview available for this file type — use the download button.</p>
            )}
          <div className="mt-4 flex gap-2">
            {data.contentUrl && (
              <a className="btn-primary" href={data.contentUrl} download={data.name}>
                Download
              </a>
            )}
            {data.webViewLink && (
              <a className="btn-ghost" href={data.webViewLink} target="_blank" rel="noreferrer">
                Open in Drive
              </a>
            )}
          </div>
        </div>
      ) : (
        <p className="text-slate-400">Loading…</p>
      )}
    </main>
  );
}

function isImage(m: string): boolean { return m.startsWith("image/"); }
function isVideo(m: string): boolean { return m.startsWith("video/"); }
function isAudio(m: string): boolean { return m.startsWith("audio/"); }
function isPdf(m: string): boolean { return m === "application/pdf"; }
function isText(m: string): boolean {
  return (
    m.startsWith("text/") ||
    m === "application/json" ||
    m === "application/xml" ||
    m === "application/javascript"
  );
}

/** Fetches the worker-proxied content URL and renders the body as text. */
function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setText(null);
    setError(null);
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((body) => {
        if (alive) setText(body);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "Failed to load text.");
      });
    return () => {
      alive = false;
    };
  }, [url]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (text == null) return <p className="text-slate-400">Loading text…</p>;
  return (
    <pre className="whitespace-pre-wrap break-words bg-slate-50 rounded p-3 max-h-[70vh] overflow-auto text-sm">
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
