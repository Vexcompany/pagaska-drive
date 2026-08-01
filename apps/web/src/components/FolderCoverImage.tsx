"use client";

/**
 * FolderCoverImage — renders a folder's cover image if one is set.
 * Uses the cached thumbnail URL from the cover store so it works
 * even when the subfolder's file listing is not loaded.
 *
 * Uses useFolderCoverVersion to re-render when the cover store changes.
 * 
 * IMPORTANT: If no cover has been explicitly set by the user, this
 * component returns null — it never falls back to an unrelated image
 * from the current directory listing. The default folder icon is the
 * correct fallback and is rendered by the caller.
 */

import { useMemo } from "react";
import type { DriveFile } from "@pagaska/shared";
import { getFolderCover, useFolderCoverVersion } from "@/stores/useFolderCoverStore";

interface FolderCoverImageProps {
  folder: DriveFile;
  className?: string;
}

export function FolderCoverImage({ folder, className = "" }: FolderCoverImageProps) {
  // Subscribe to cover store changes so we re-render when a cover is set
  useFolderCoverVersion();

  const coverUrl = useMemo(() => {
    // Only use explicitly-set cover — never fall back to a random image
    const explicitCover = getFolderCover(folder.id);
    return explicitCover?.thumbnailUrl ?? null;
  }, [folder.id]);

  if (!coverUrl) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={coverUrl}
      alt={folder.name}
      className={`object-cover rounded-xl ${className}`}
      loading="lazy"
    />
  );
}

/**
 * Returns the thumbnail URL for a folder's cover image, or null.
 * Uses the cached thumbnail URL from the cover store, so it works
 * without needing the subfolder's file listing.
 *
 * Only returns a URL if the user has explicitly set a folder cover.
 * Returns null otherwise — the caller should show the default folder icon.
 *
 * IMPORTANT: The caller MUST subscribe to `useFolderCoverVersion()`
 * so that the component re-renders when the cover store changes.
 */
export function getFolderCoverUrl(folderId: string): string | null {
  const explicitCover = getFolderCover(folderId);
  return explicitCover?.thumbnailUrl ?? null;
}
