"use client";

/**
 * Enhanced Properties dialog — shows detailed file/folder information
 * including name, type, size, dates, location, sharing status, etc.
 */

import { useState } from "react";
import {
  X,
  Copy,
  ExternalLink,
  Link as LinkIcon,
  Loader2,
  Folder,
} from "lucide-react";
import { Button, Badge, Card, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import { formatSize, formatDateTime, typeLabel } from "@/lib/format";
import type { DriveFile, PreviewResponse, ShareStatusResponse } from "@pagaska/shared";

interface PropertiesPanelProps {
  item: DriveFile;
  /** Breadcrumb path to the item's folder. */
  breadcrumb: { id: string; name: string }[];
  /** Current workspace name. */
  workspace: string;
  /** Folder ID for generating a location link. */
  folderId: string | null;
  onClose: () => void;
}

export function PropertiesPanel({
  item,
  breadcrumb,
  workspace,
  folderId,
  onClose,
}: PropertiesPanelProps) {
  const [shareStatus, setShareStatus] = useState<ShareStatusResponse | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const isFolder = item.mimeType === "application/vnd.google-apps.folder";

  // Lazy-load share status
  function loadShareStatus() {
    if (shareStatus || shareLoading) return;
    setShareLoading(true);
    api.shareStatus(item.id)
      .then((s) => setShareStatus(s))
      .catch(() => {})
      .finally(() => setShareLoading(false));
  }

  async function copyLink() {
    const link = shareStatus?.webViewLink ?? item.webViewLink;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", link);
    }
  }

  // Build the folder location path
  const locationPath = breadcrumb.map((c) => c.name).join(" / ") || "My Drive";

  return (
    <Modal open onClose={onClose} className="max-w-md">
      <Card className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            {isFolder ? (
              <Folder className="h-5 w-5 text-brand-500 shrink-0" />
            ) : (
              <span className="text-xs text-slate-400">{typeLabel(item.mimeType)}</span>
            )}
            <h2 className="font-semibold text-slate-900 truncate">{item.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Properties table */}
        <div className="space-y-3 text-sm">
          <PropertyRow label="Name" value={item.name} />
          <PropertyRow label="Type" value={isFolder ? "Folder" : typeLabel(item.mimeType)} />
          <PropertyRow label="MIME Type" value={item.mimeType} mono />
          <PropertyRow label="Size" value={isFolder ? "—" : formatSize(item.size)} />
          <PropertyRow label="Modified" value={formatDateTime(item.modifiedTime)} />
          <PropertyRow label="Location" value={locationPath} />
          <PropertyRow label="Workspace" value={workspace} />

          {/* Trash status */}
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Status</span>
            {item.trashed ? (
              <Badge color="red" dot>In Trash</Badge>
            ) : (
              <Badge color="green" dot>Active</Badge>
            )}
          </div>

          {/* Sharing status */}
          <div className="flex justify-between items-start">
            <span className="text-slate-500">Shared</span>
            <div className="flex items-center gap-2">
              {shareLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
              ) : shareStatus ? (
                <Badge color={shareStatus.public ? "green" : "slate"} dot>
                  {shareStatus.public ? "Public" : "Restricted"}
                </Badge>
              ) : (
                <button
                  onClick={loadShareStatus}
                  className="text-xs text-brand-500 hover:text-brand-600 transition-colors"
                >
                  Check
                </button>
              )}
            </div>
          </div>

          {/* Public link */}
          {(shareStatus?.public || item.webViewLink) && !item.trashed && (
            <div className="flex justify-between items-start">
              <span className="text-slate-500">Public Link</span>
              <div className="flex items-center gap-1.5 max-w-[16rem]">
                {shareStatus?.webViewLink && (
                  <>
                    <a
                      href={shareStatus.webViewLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-brand-500 hover:text-brand-600 truncate"
                    >
                      {shareStatus.webViewLink}
                    </a>
                    <button
                      onClick={copyLink}
                      className="rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all shrink-0"
                      title="Copy link"
                    >
                      {copied ? <span className="text-xs text-emerald-600">✓</span> : <Copy className="h-3 w-3" />}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ID */}
          <PropertyRow label="ID" value={item.id} mono truncate />
        </div>

        {/* Close */}
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </Card>
    </Modal>
  );
}

function PropertyRow({ label, value, mono, truncate }: { label: string; value: string; mono?: boolean; truncate?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span
        className={`text-slate-900 text-right ${mono ? "font-mono text-xs" : "font-medium"} ${truncate ? "truncate max-w-[16rem]" : ""}`}
      >
        {value || "—"}
      </span>
    </div>
  );
}
