"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api, authHeaders } from "@/lib/api";
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
  // The worker's /media endpoint is authenticated, but native elements
  // (<img>, <video>, <audio>, <iframe>) and download links cannot send an
  // Authorization header. Fetch the bytes once with auth and expose them
  // as a same-origin blob: URL for those elements.
  const { blobUrl: contentUrl, error: contentError } = useAuthedBlob(data?.contentUrl ?? null);

  useEffect(() => {
    if (!loading && !workspace) router.replace("/");
  }, [loading, workspace, router]);

  useEffect(() => {
    if (!id) return;
    api.preview(id).then(setData).catch((err) => setError(err instanceof Error ? err.message : "Failed."));
  }, [id]);

  if (!id) {
    return (
      <main className="min-h-screen p-6 max-w-5xl mx-auto text-center py-16">
        <div className="text-5xl mb-3">👀</div>
        <p className="text-slate-500 font-medium">Nothing to preview</p>
        <p className="text-sm text-slate-400 mt-1">No file was selected. Go back to your drive and pick a file.</p>
        <Link href="/drive" className="btn-ghost mt-4 text-sm">Back to drive</Link>
      </main>
    );
  }
  if (!workspace) return null;

  return (
    <main className="min-h-screen p-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Preview</h1>
        <Link className="btn-ghost" href="/drive">Back to drive</Link>
      </header>
      {error && (
        <div className="card p-6 text-center py-12">
          <div className="text-4xl mb-2">⚠️</div>
          <p className="text-red-600 font-medium">{error}</p>
          <p className="text-sm text-slate-400 mt-1">This file could not be previewed.</p>
          <Link href="/drive" className="btn-ghost mt-4 text-sm">Back to drive</Link>
        </div>
      )}
      {contentError && <p className="text-sm text-red-600 mb-2">Content failed to load: {contentError}</p>}
      {data ? (
        <div className="card p-6">
          <h2 className="text-lg font-semibold mb-2">{data.name}</h2>
          <p className="text-sm text-slate-500 mb-4">
            {data.mimeType} · {formatSize(data.size)}
          </p>
          {isImage(data.mimeType) && contentUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={contentUrl} alt={data.name} className="max-w-full rounded" />
          )}
          {isVideo(data.mimeType) && contentUrl && (
            <video src={contentUrl} controls className="max-w-full rounded" />
          )}
          {isAudio(data.mimeType) && contentUrl && (
            <audio src={contentUrl} controls className="w-full" />
          )}
          {isPdf(data.mimeType) && contentUrl && (
            <iframe src={contentUrl} title={data.name} className="w-full h-[70vh] rounded border border-slate-200" />
          )}
          {isText(data.mimeType) && contentUrl && (
            <TextPreview blobUrl={contentUrl} />
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
            {contentUrl && (
              <a className="btn-primary" href={contentUrl} download={data.name}>
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
      ) : !error ? (
        <div className="card p-6 space-y-3">
          <div className="h-6 w-1/3 rounded bg-slate-100 animate-pulse" />
          <div className="h-4 w-1/4 rounded bg-slate-100 animate-pulse" />
          <div className="h-72 rounded-xl bg-slate-100 animate-pulse" />
        </div>
      ) : null}
    </main>
  );
}

/**
 * Fetches a protected Worker content URL (e.g. /media?id=…) with the
 * Authorization header and exposes the result as a blob: object URL.
 * Native elements (<img>, <video>, <audio>, <iframe>) and download
 * links cannot carry custom headers, so the authenticated fetch happens
 * here and the browser only ever sees a same-origin blob URL. The blob
 * URL is revoked when the URL changes or the component unmounts.
 */
function useAuthedBlob(url: string | null): { blobUrl: string | null; error: string | null } {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setBlobUrl(null);
      setError(null);
      return;
    }
    let alive = true;
    let objectUrl: string | null = null;
    setBlobUrl(null);
    setError(null);
    fetch(url, { headers: authHeaders() })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "Failed to load content.");
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return { blobUrl, error };
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

/**
 * Renders the already-authenticated content (a blob: URL produced by
 * useAuthedBlob) as text. Reading a blob URL needs no headers, so this
 * never triggers a second authenticated request.
 */
function TextPreview({ blobUrl }: { blobUrl: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setText(null);
    setError(null);
    fetch(blobUrl)
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
  }, [blobUrl]);

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
