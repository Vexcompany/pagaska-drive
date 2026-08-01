"use client";

/**
 * Folder cover store — persists which image is used as a folder's
 * cover thumbnail. Uses localStorage so it survives page reloads.
 *
 * The store maps folder IDs to image file IDs. If the selected
 * image is deleted from Drive, the cover automatically falls back
 * to the first image in the folder.
 */

import { useState, useEffect } from "react";

const STORAGE_KEY = "pagaska.folderCovers";

interface CoverMap {
  [folderId: string]: string; // folderId → imageFileId
}

function loadCovers(): CoverMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCovers(covers: CoverMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(covers));
  } catch {
    // Storage full or unavailable
  }
}

// ── Module-level singleton ──────────────────────────────────────────────

let covers: CoverMap = loadCovers();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

// ── Public actions ──────────────────────────────────────────────────────

export function setFolderCover(folderId: string, imageFileId: string): void {
  covers = { ...covers, [folderId]: imageFileId };
  saveCovers(covers);
  notify();
}

export function removeFolderCover(folderId: string): void {
  const next = { ...covers };
  delete next[folderId];
  covers = next;
  saveCovers(covers);
  notify();
}

/**
 * If the given imageFileId was used as a cover for any folder,
 * remove it (e.g. because the image was deleted).
 */
export function removeCoverByImage(imageFileId: string): void {
  let changed = false;
  const next: CoverMap = {};
  for (const [fid, iid] of Object.entries(covers)) {
    if (iid === imageFileId) {
      changed = true;
    } else {
      next[fid] = iid;
    }
  }
  if (changed) {
    covers = next;
    saveCovers(covers);
    notify();
  }
}

export function getFolderCover(folderId: string): string | null {
  return covers[folderId] ?? null;
}

// ── Hook ────────────────────────────────────────────────────────────────

export function useFolderCoverMap(): CoverMap {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  return covers;
}
