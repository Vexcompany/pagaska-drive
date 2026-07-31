"use client";

/**
 * Authenticated downloads. The Worker's /download endpoints require an
 * Authorization header, but an <a download> click cannot carry headers,
 * so every download is: fetch with auth → blob → object URL → click.
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
