"use client";

/**
 * Authenticated downloads. The Worker's /download endpoints require an
 * Authorization header, but an <a download> click cannot carry headers,
 * so every download is: fetch with auth → blob → object URL → click
 */

import { API_URL, authHeaders } from "./api";
import type { DriveFile } from "@pagaska/shared";

/** Fetches a protected download URL and triggers a browser download. */
export async function downloadUrl(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}

/** Downloads a single file (or folder-as-zip). */
export function downloadItem(item: DriveFile): Promise<void> {
  if (item.mimeType === "application/vnd.google-apps.folder") {
    return downloadUrl(`${API_URL}/download/folder?id=${encodeURIComponent(item.id)}`, `${item.name}.zip`);
  }
  return downloadUrl(`${API_URL}/download?id=${encodeURIComponent(item.id)}`, item.name);
}

/**
 * Download multiple selected items.
 *
 * Strategy:
 * - If exactly 1 item is selected, download it directly.
 * - If the item is a folder, use the Worker's /download/folder endpoint
 *   which produces a ZIP server-side — fast and efficient.
 * - If multiple items are selected:
 *   - For folders: use the server-side /download/folder (already a ZIP)
 *   - For files: download them in parallel (concurrency=4) and build
 *     a client-side ZIP.
 *   - If all items are files, build a single ZIP.
 *   - If there's a mix of folders and files, download each as a
 *     separate file (folders as ZIPs, files individually).
 *
 * Performance improvements over the original:
 * - Parallel downloads with concurrency limit (4) instead of sequential
 * - Server-side ZIP for folders instead of re-downloading and re-packaging
 * - Use STORE method (no compression) for already-compressed file types
 *   (images, videos, archives) to avoid expensive DEFLATE on them
 * - Only compress text-based files that benefit from it
 */

const DOWNLOAD_CONCURRENCY = 4;

/** Download multiple items — if multiple, produces a single ZIP. */
export async function downloadSelected(items: DriveFile[]): Promise<void> {
  if (items.length === 0) return;

  // Single item — direct download
  if (items.length === 1) {
    return downloadItem(items[0]);
  }

  // Multiple items — build a client-side ZIP with parallel downloads
  const { buildClientZip } = await import("./zip-builder");
  const zipBlob = await buildClientZip(items);
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "download.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
