"use client";

/**
 * FolderCoverImage — renders a folder's cover image if one is set,
 * or falls back to the first image in the folder. If no images exist,
 * shows nothing (the parent component renders the folder icon).
 */

import { useMemo } from "react";
import type { DriveFile } from "@pagaska/shared";
import { getFolderCover } from "@/stores/useFolderCoverStore";

interface FolderCoverImageProps {
  folder: DriveFile;
  /** All files in the folder (used to find the first image). */
  files: DriveFile[];
  className?: string;
}

export function FolderCoverImage({ folder, files, className = "" }: FolderCoverImageProps) {
  const coverImageId = useMemo(() => {
    // Check if user explicitly set a cover
    const explicitCover = getFolderCover(folder.id);
    if (explicitCover) {
      const exists = files.find((f) => f.id === explicitCover);
      if (exists) return explicitCover;
    }
    // Fall back to first image in the folder
    const firstImage = files.find((f) =>
      f.mimeType.startsWith("image/") && f.thumbnailLink
    );
    return firstImage?.thumbnailLink ? firstImage.id : null;
  }, [folder.id, files]);

  if (!coverImageId) return null;

  // Find the image file to get its thumbnail
  const imageFile = files.find((f) => f.id === coverImageId);
  if (!imageFile?.thumbnailLink) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageFile.thumbnailLink}
      alt={folder.name}
      className={`object-cover rounded-xl ${className}`}
      loading="lazy"
    />
  );
}

/**
 * Returns the thumbnail URL for a folder's cover image, or null.
 * Useful for grid view where we need the URL directly.
 */
export function getFolderCoverUrl(
  folderId: string,
  files: DriveFile[]
): string | null {
  const explicitCover = getFolderCover(folderId);
  if (explicitCover) {
    const exists = files.find((f) => f.id === explicitCover);
    if (exists?.thumbnailLink) return exists.thumbnailLink;
  }
  const firstImage = files.find((f) =>
    f.mimeType.startsWith("image/") && f.thumbnailLink
  );
  return firstImage?.thumbnailLink ?? null;
}
