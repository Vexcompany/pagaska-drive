"use client";

/**
 * Folder cover store — persists which image is used as a folder's
 * cover thumbnail. Uses localStorage so it survives page reloads.
 *
 * Stores both the image file ID and its thumbnail URL so the
 * cover can be rendered without needing the subfolder's file listing.
 *
 * IMPORTANT: The store uses a version counter to force React
 * re-renders when the cover map changes. Components that read
 * cover data MUST use the `useFolderCoverVersion` hook so they
 * re-render when a cover is set.
 */

import { useState, useEffect } from "react";

const STORAGE_KEY = "pagaska.folderCovers";

interface CoverEntry {
  /** The Drive file ID of the cover image. */
  imageId: string;
  /** The thumbnail URL of the cover image (cached at set-time). */
  thumbnailUrl: string;
}

interface CoverMap {
  [folderId: string]: CoverEntry;
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

/**
 * Monotonically increasing version counter. Every mutation bumps
 * this so consumers can detect changes without deep-comparing the
 * entire map.
 */
let version = 0;

const listeners = new Set<() => void>();

function notify() {
  version++;
  listeners.forEach((l) => l());
}

// ── Public actions ──────────────────────────────────────────────────────

export function setFolderCover(folderId: string, imageId: string, thumbnailUrl: string): void {
  covers = { ...covers, [folderId]: { imageId, thumbnailUrl } };
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
  for (const [fid, entry] of Object.entries(covers)) {
    if (entry.imageId === imageFileId) {
      changed = true;
    } else {
      next[fid] = entry;
    }
  }
  if (changed) {
    covers = next;
    saveCovers(covers);
    notify();
  }
}

/** Get the cover entry for a folder (includes thumbnail URL). */
export function getFolderCover(folderId: string): CoverEntry | null {
  return covers[folderId] ?? null;
}

export function getFolderCoverMap(): CoverMap {
  return covers;
}

export function getFolderCoverVersion(): number {
  return version;
}

// ── Hooks ────────────────────────────────────────────────────────────────

/**
 * Subscribe to cover map changes. Returns the current version
 * number; when it changes, the consuming component re-renders
 * and can re-read the map via getFolderCover() etc.
 */
export function useFolderCoverVersion(): number {
  const [ver, setVer] = useState(version);

  useEffect(() => {
    const listener = () => setVer(version);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  return ver;
}

/** Convenience hook that returns the full cover map, re-rendering on change. */
export function useFolderCoverMap(): CoverMap {
  useFolderCoverVersion();
  return covers;
}
