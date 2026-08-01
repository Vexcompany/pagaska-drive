"use client";

/** 
 * FolderStatsDisplay — renders file count, folder count, and total size
 * for a folder. E.g. "184 Files · 12 Folders · 2.8 GB"
 */

import type { DriveFile, DriveFolder } from "@pagaska/shared";
import { formatSize } from "@/lib/format";

interface FolderStatsDisplayProps {
  files: DriveFile[];
  folders: DriveFolder[];
  className?: string;
}

export function FolderStatsDisplay({ files, folders, className = "" }: FolderStatsDisplayProps) {
  const fileCount = files.length;
  const folderCount = folders.length;
  const totalSize = files.reduce((sum, f) => sum + (f.size ?? 0), 0);

  if (fileCount === 0 && folderCount === 0) return null;

  const parts: string[] = [];
  if (fileCount > 0) parts.push(`${fileCount} File${fileCount !== 1 ? "s" : ""}`);
  if (folderCount > 0) parts.push(`${folderCount} Folder${folderCount !== 1 ? "s" : ""}`);
  if (totalSize > 0) parts.push(formatSize(totalSize));

  return (
    <span className={`text-xs text-slate-400 tabular-nums ${className}`}>
      {parts.join(" · ")}
    </span>
  );
}
