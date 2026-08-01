"use client";

/**
 * FolderCoverImage — renders a folder's cover image if one is set.
 * Uses the cached thumbnail URL from the cover store so it works
 * even when the subfolder's file listing is not loaded.
 *
 * Uses useFolderCoverVersion to re-render when the cover store changes.
 */

import { useMemo } from "react";
import type { DriveFile } from "@pagaska/shared";
import { getFolderCover, useFolderCoverVersion } from "@/stores/useFolderCoverStore";

interface FolderCoverImageProps {
  folder: DriveFile;
  /** All files in the folder (used to find the first image as fallback). */
  files: DriveFile[];
  className?: string;
}

export function FolderCoverImage({ folder, files, className = "" }: FolderCoverImageProps) {
  // Subscribe to cover store changes so we re-render when a cover is set
  useFolderCoverVersion();

  const coverUrl = useMemo(() => {
    // Check if user explicitly set a cover (has cached thumbnail URL)
    const explicitCover = getFolderCover(folder.id);
    if (explicitCover?.thumbnailUrl) return explicitCover.thumbnailUrl;

    // Fall back to first image in the folder
    const firstImage = files.find((f) =>
      f.mimeType.startsWith("image/") && f.thumbnailLink
    );
    return firstImage?.thumbnailLink ?? null;
  }, [folder.id, files]);

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
 * IMPORTANT: The caller MUST subscribe to `useFolderCoverVersion()`
 * so that the component re-renders when the cover store changes.
 */
export function getFolderCoverUrl(
  folderId: string,
  files: DriveFile[]
): string | null {
  // Check if user explicitly set a cover (has cached thumbnail URL)
  const explicitCover = getFolderCover(folderId);
  if (explicitCover?.thumbnailUrl) return explicitCover.thumbnailUrl;

  // Fall back to first image in the current listing
  const firstImage = files.find((f) =>
    f.mimeType.startsWith("image/") && f.thumbnailLink
  );
  return firstImage?.thumbnailLink ?? null;
}
