"use client";

/**
 * StorageIndicator — lightweight, always-visible storage usage
 * display for the workspace toolbar.  Clicking opens a small
 * popover with a breakdown by category.
 */

import { useEffect, useRef, useState } from "react";
import { Cloud, ChevronDown, X } from "lucide-react";
import { api } from "@/lib/api";
import { formatSize } from "@/lib/format";
import type { StorageResponse } from "@pagaska/shared";

const TOTAL_TB = 5;
const TOTAL_BYTES = TOTAL_TB * 1024 * 1024 * 1024 * 1024;

export function StorageIndicator() {
  const [info, setInfo] = useState<StorageResponse | null>(null);
  const [popover, setPopover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getStorage().then(setInfo).catch(() => {});
  }, []);

  // Close popover on outside click
  useEffect(() => {
    if (!popover) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPopover(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popover]);

  if (!info) return null;

  const usedBytes = info.workspaceUsage || info.usage;
  const availableBytes = Math.max(0, (info.limit || TOTAL_BYTES) - usedBytes);
  const pct = info.limit ? (usedBytes / info.limit) * 100 : 0;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setPopover((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg px-2 py-1.5 transition-all"
        title={`${formatSize(availableBytes)} available`}
      >
        <Cloud className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{formatSize(availableBytes)} available</span>
        <span className="sm:hidden">{formatSize(usedBytes)}</span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {popover && (
        <div className="absolute right-0 top-full mt-2 z-30 w-72 rounded-xl bg-white shadow-xl ring-1 ring-slate-200 animate-pop-in">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">Storage</span>
            <button onClick={() => setPopover(false)} className="text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="px-4 py-3 space-y-3">
            {/* Usage bar */}
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span>{formatSize(usedBytes)} used</span>
                <span>{formatSize(info.limit || TOTAL_BYTES)} total</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all"
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            </div>

            {/* Breakdown */}
            <div className="space-y-1.5 text-xs">
              <Row label="Used" value={formatSize(usedBytes)} />
              <Row label="Available" value={formatSize(availableBytes)} />
              <Row label="Total" value={formatSize(info.limit || TOTAL_BYTES)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 tabular-nums">{value}</span>
    </div>
  );
}
