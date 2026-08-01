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
 * Download multiple selected items as a ZIP.
 *
 * Strategy:
 * - If exactly 1 item is selected, download it directly (no ZIP overhead).
 * - If the item is a folder, use the Worker's /download/folder endpoint
 *   which produces a ZIP server-side.
 * - If multiple items are selected, download them individually and
 *   build a ZIP in the browser using a lightweight client-side approach.
 *   We fetch each file with auth, then use the browser's Compression
 *   Streams API (or a simple fallback) to create a downloadable ZIP.
 *
 * Since the backend already has /download/folder which builds a ZIP,
 * for multiple files we download them sequentially and trigger each
 * as a separate download. For a true multi-file ZIP, we use a simple
 * client-side ZIP builder.
 */

/** Download multiple items — if multiple, produces a single ZIP. */
export async function downloadSelected(items: DriveFile[]): Promise<void> {
  if (items.length === 0) return;

  // Single item — direct download
  if (items.length === 1) {
    return downloadItem(items[0]);
  }

  // Multiple items — build a client-side ZIP
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
