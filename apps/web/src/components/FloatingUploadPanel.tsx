"use client";

/**
 * Floating upload panel — appears at the bottom-right of the screen
 * when uploads are active. Can be minimized to a small pill or
 * expanded to show per-file progress.
 *
 * Uploads continue while the user browses the drive.
 */

import { useEffect } from "react";
import {
  Pause,
  Play,
  RotateCcw,
  X,
  ChevronUp,
  ChevronDown,
  CloudUpload,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button, ProgressBar, StatusBadge } from "@/components/ui";
import {
  useUploadPanel,
  pauseAllUploads,
  resumeAllUploads,
  retryAllFailedUploads,
  cancelAllUploads,
  pauseFile,
  resumeFile,
  retryFile,
  cancelFile,
  setPanelMinimized,
  closePanel,
} from "@/hooks/useUploadPanel";
import { formatSize, formatSpeed, formatRemaining } from "@/lib/format";

export function FloatingUploadPanel() {
  const panel = useUploadPanel();

  // Auto-minimize the panel 5 seconds after all uploads complete.
  // The user can still expand it to review per-file results.
  useEffect(() => {
    if (panel.allDone && !panel.minimized) {
      const timer = setTimeout(() => setPanelMinimized(true), 5000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [panel.allDone, panel.minimized]);

  if (!panel.visible) return null;

  const { snapshot, files, minimized, isActive, allDone } = panel;

  // Minimized pill
  if (minimized) {
    return (
      <button
        onClick={() => setPanelMinimized(false)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-xl bg-brand-500 text-white px-4 py-2.5 shadow-lg hover:bg-brand-600 transition-all text-sm font-medium animate-pop-in"
      >
        <CloudUpload className="h-4 w-4" />
        {isActive ? (
          <>
            Uploading…
            {snapshot && (
              <span className="text-brand-200 tabular-nums">
                {Math.round(snapshot.fraction * 100)}%
              </span>
            )}
          </>
        ) : allDone ? (
          <>
            <CheckCircle2 className="h-4 w-4" />
            Done
          </>
        ) : null}
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
    );
  }

  // Expanded panel
  const pct = snapshot ? snapshot.fraction * 100 : 0;

  // Compute completion summary
  const completedFiles = files.filter((f) => f.state === "completed");
  const completedFolders = new Set(
    completedFiles
      .map((f) => {
        // Files with paths like "folder/subfolder/file.txt" belong to a folder
        const parts = f.relativePath.split("/");
        return parts.length > 1 ? parts[0] : null;
      })
      .filter(Boolean)
  ).size;
  const standaloneFiles = completedFiles.filter((f) => !f.relativePath.includes("/")).length;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-96 max-w-[calc(100vw-2rem)] animate-pop-in">
      <div className="rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2 min-w-0">
            <CloudUpload className="h-4 w-4 text-brand-500 shrink-0" />
            <span className="text-sm font-semibold text-slate-900 truncate">
              {allDone ? "Uploads complete" : isActive ? "Uploading…" : "Uploads"}
            </span>
            {snapshot && snapshot.totalFiles > 0 && (
              <span className="text-xs text-slate-400 tabular-nums shrink-0">
                {snapshot.uploadedFiles}/{snapshot.totalFiles}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPanelMinimized(true)}
              className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
              title="Minimize"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {allDone && (
              <button
                onClick={closePanel}
                className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
                title="Close"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Completion summary */}
        {allDone && completedFiles.length > 0 && (
          <div className="px-4 py-3 border-b border-slate-50 bg-emerald-50/50">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              All uploads completed
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-emerald-600">
              {completedFolders > 0 && (
                <span>{completedFolders} folder{completedFolders > 1 ? "s" : ""}</span>
              )}
              {standaloneFiles > 0 && (
                <span>{standaloneFiles} file{standaloneFiles > 1 ? "s" : ""}</span>
              )}
              {completedFolders > 0 && standaloneFiles > 0 && (
                <span className="text-emerald-400">·</span>
              )}
              <span className="text-emerald-500">{formatSize(snapshot?.uploadedBytes ?? 0)}</span>
            </div>
          </div>
        )}

        {/* Overall progress */}
        {snapshot && snapshot.totalFiles > 0 && (
          <div className="px-4 py-3 border-b border-slate-50">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-slate-500 tabular-nums">
                {formatSize(snapshot.uploadedBytes)} / {formatSize(snapshot.totalBytes)}
                {formatSpeed(snapshot.overallSpeedBps)}
                {formatRemaining(snapshot.remainingSeconds)}
              </span>
              <span className="text-xs font-semibold text-slate-700 tabular-nums">
                {pct.toFixed(0)}%
              </span>
            </div>
            <ProgressBar value={pct} />

            {/* Status pills */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {snapshot.queuedFiles > 0 && (
                <span className="text-[10px] text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
                  {snapshot.queuedFiles} queued
                </span>
              )}
              {snapshot.retryingFiles > 0 && (
                <span className="text-[10px] text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
                  {snapshot.retryingFiles} retrying
                </span>
              )}
              {snapshot.failedFiles > 0 && (
                <span className="text-[10px] text-red-700 bg-red-50 rounded-full px-2 py-0.5 flex items-center gap-0.5">
                  <AlertCircle className="h-2.5 w-2.5" />
                  {snapshot.failedFiles} failed
                </span>
              )}
              {snapshot.uploadedFiles > 0 && (
                <span className="text-[10px] text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">
                  {snapshot.uploadedFiles} done
                </span>
              )}
            </div>
          </div>
        )}

        {/* Bulk controls */}
        {files.length > 0 && (
          <div className="flex gap-1 px-4 py-2 border-b border-slate-50 flex-wrap">
            <Button variant="ghost" size="sm" onClick={retryAllFailedUploads} className="text-xs px-2 py-1">
              <RotateCcw className="h-3 w-3" /> Retry
            </Button>
            {isActive ? (
              <Button variant="ghost" size="sm" onClick={pauseAllUploads} className="text-xs px-2 py-1">
                <Pause className="h-3 w-3" /> Pause
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={resumeAllUploads} className="text-xs px-2 py-1">
                <Play className="h-3 w-3" /> Resume
              </Button>
            )}
            <Button variant="danger" size="sm" onClick={cancelAllUploads} className="text-xs px-2 py-1">
              <X className="h-3 w-3" /> Cancel
            </Button>
          </div>
        )}

        {/* Per-file list */}
        <div className="max-h-64 overflow-y-auto">
          {files.map((f) => {
            const filePct = f.size > 0 ? (f.bytesUploaded / f.size) * 100 : 0;
            const isUploading = f.state === "uploading" || f.state === "retrying";
            return (
              <div
                key={f.id}
                className="px-4 py-2.5 flex items-start gap-3 border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs font-medium text-slate-800 truncate">{f.relativePath}</span>
                    <StatusBadge state={f.state} />
                  </div>
                  {(isUploading || f.state === "paused") && (
                    <ProgressBar value={filePct} className="mb-1" />
                  )}
                  <div className="flex items-center gap-2 text-[10px] text-slate-400 tabular-nums">
                    <span>{formatSize(f.bytesUploaded)} / {formatSize(f.size)}</span>
                    {f.speedBps > 0 && <span>{formatSpeed(f.speedBps)}</span>}
                    {f.state === "failed" && f.errorMessage && (
                      <span className="text-red-500 truncate max-w-[12rem]" title={f.errorMessage}>
                        {f.errorMessage}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {isUploading ? (
                    <button
                      className="rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
                      onClick={() => pauseFile(f.id)}
                      title="Pause"
                    >
                      <Pause className="h-3 w-3" />
                    </button>
                  ) : f.state === "paused" ? (
                    <button
                      className="rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
                      onClick={() => resumeFile(f.id)}
                      title="Resume"
                    >
                      <Play className="h-3 w-3" />
                    </button>
                  ) : null}
                  {f.state === "failed" && (
                    <button
                      className="rounded p-1 text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-all"
                      onClick={() => retryFile(f.id)}
                      title="Retry"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  )}
                  {(isUploading || f.state === "queued" || f.state === "paused" || f.state === "failed") && (
                    <button
                      className="rounded p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all"
                      onClick={() => cancelFile(f.id)}
                      title="Cancel"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
