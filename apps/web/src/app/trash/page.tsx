"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import {
  Trash2,
  Folder,
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  FileArchive,
  FileSpreadsheet,
  Presentation,
  File,
  Search,
  X,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  LayoutGrid,
  List,
  House,
  ChevronRight,
  Loader2,
  SlidersHorizontal,
  Info,
  Eye,
  Link as LinkIcon,
  Pencil,
  MoveRight,
} from "lucide-react";
import {
  Button,
  Badge,
  Card,
  Spinner,
  Skeleton,
  Modal,
  ErrorBanner,
  ContextMenu,
} from "@/components/ui";
import type { DriveFile, SearchItem, TrashListResponse, TrashSearchResponse } from "@pagaska/shared";

type ViewMode = "grid" | "list";
type SortKey = "name" | "modified" | "size" | "type";
type SortDir = "asc" | "desc";

const VIEW_KEY = "pagaska.trash.view";
const SORT_KEY = "pagaska.trash.sortKey";
const SORT_DIR_KEY = "pagaska.trash.sortDir";

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (raw as unknown as T);
  } catch {
    return fallback;
  }
}

export default function TrashPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand-400" />
      </main>
    }>
      <TrashInner />
    </Suspense>
  );
}

function TrashInner() {
  const { workspace, loading, logout } = useAuth();
  const router = useRouter();

  const [data, setData] = useState<TrashListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TrashSearchResponse | null>(null);
  const [searching, setSearching] = useState(false);

  const [view, setView] = useState<ViewMode>(() => readLocal<ViewMode>(VIEW_KEY, "list"));
  const [sortKey, setSortKey] = useState<SortKey>(() => readLocal<SortKey>(SORT_KEY, "name"));
  const [sortDir, setSortDir] = useState<SortDir>(() => readLocal<SortDir>(SORT_DIR_KEY, "asc"));
  const [showSortMenu, setShowSortMenu] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClicked = useRef<string | null>(null);

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; item: DriveFile } | null>(null);

  // Properties dialog.
  const [propsItem, setPropsItem] = useState<DriveFile | null>(null);

  const isSearching = Boolean(query.trim()) && results !== null;

  const refresh = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const next = await api.listTrash();
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trash.");
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && !workspace) router.replace("/");
  }, [loading, workspace, router]);

  useEffect(() => {
    if (workspace) void refresh();
  }, [workspace, refresh]);

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_KEY, view);
      window.localStorage.setItem(SORT_KEY, sortKey);
      window.localStorage.setItem(SORT_DIR_KEY, sortDir);
    } catch { /* */ }
  }, [view, sortKey, sortDir]);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); setSearching(false); return; }
    setSearching(true);
    const t = window.setTimeout(() => {
      api.searchTrash(q)
        .then((r) => setResults(r))
        .catch((err) => setError(err instanceof Error ? err.message : "Search failed."))
        .finally(() => setSearching(false));
    }, 180);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setSelected(new Set());
    lastClicked.current = null;
  }, [query]);

  const folders = useMemo(() => {
    const src: DriveFile[] = results ? results.folders : (data?.folders ?? []);
    return [...src].sort((a, b) => compareItems(a, b, sortKey, sortDir));
  }, [results, data, sortKey, sortDir]);

  const files = useMemo(() => {
    const src: DriveFile[] = results ? results.files : (data?.files ?? []);
    return [...src].sort((a, b) => compareItems(a, b, sortKey, sortDir));
  }, [results, data, sortKey, sortDir]);

  const ordered = useMemo(() => [...folders, ...files], [folders, files]);

  // ── Actions ─────────────────────────────────────────────────────────────

  async function restoreSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      await api.restoreItems({ fileIds: ids });
      setSelected(new Set());
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed.");
    }
  }

  async function restoreOne(id: string) {
    try {
      await api.restoreItems({ fileIds: [id] });
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed.");
    }
  }

  async function deleteForeverSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`Permanently delete ${ids.length} item${ids.length > 1 ? "s" : ""}? This cannot be undone.`)) return;
    try {
      await api.deleteForever({ fileIds: ids });
      setSelected(new Set());
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete forever failed.");
    }
  }

  async function deleteForeverOne(id: string, name: string) {
    if (!confirm(`Permanently delete "${name}"? This cannot be undone.`)) return;
    try {
      await api.deleteForever({ fileIds: [id] });
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete forever failed.");
    }
  }

  // ── Selection ───────────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    lastClicked.current = id;
  }

  function selectRange(fromId: string, toId: string) {
    const ids = ordered.map((i) => i.id);
    const a = ids.indexOf(fromId);
    const b = ids.indexOf(toId);
    if (a === -1 || b === -1) return;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    setSelected(new Set(ids.slice(lo, hi + 1)));
  }

  function handleRowClick(e: React.MouseEvent, item: DriveFile, index: number) {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); toggleSelect(item.id); return; }
    if (e.shiftKey && lastClicked.current) { e.preventDefault(); selectRange(lastClicked.current, item.id); return; }
    toggleSelect(item.id);
  }

  function handleContextMenu(e: React.MouseEvent, item: DriveFile) {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, item });
  }

  if (!workspace) return null;

  const selectedCount = selected.size;
  const searchQuery = query.trim();

  const sortLabels: Record<SortKey, string> = {
    name: "Name",
    modified: "Date modified",
    size: "File size",
    type: "File type",
  };

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Top nav */}
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Link
              href="/drive"
              className="flex items-center gap-2 text-brand-600 hover:text-brand-700 font-semibold shrink-0"
            >
              <House className="h-4 w-4" />
              <span className="hidden sm:inline text-sm">Drive</span>
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-slate-300 shrink-0" />
            <span className="text-sm text-slate-900 font-medium flex items-center gap-1.5">
              <Trash2 className="h-4 w-4 text-slate-400" />
              Trash
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Link href="/upload" className="inline-flex items-center gap-1.5 bg-brand-500 text-white hover:bg-brand-600 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all shadow-sm">
              <House className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Drive</span>
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search trash…"
              className="w-full pl-9 pr-10 py-2 text-sm rounded-xl border border-slate-200 bg-white shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 transition-all placeholder:text-slate-400"
              aria-label="Search trash"
            />
            {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-brand-400 animate-spin" />}
            {searchQuery && !searching && (
              <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" title="Clear search">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex gap-2 items-center">
            <div className="relative">
              <button onClick={() => setShowSortMenu((v) => !v)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 transition-all">
                <SlidersHorizontal className="h-4 w-4 text-slate-400" />
                <span className="hidden sm:inline">{sortLabels[sortKey]}</span>
                {sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-slate-400" /> : <ArrowDown className="h-3.5 w-3.5 text-slate-400" />}
              </button>
              {showSortMenu && (
                <div className="absolute right-0 top-full mt-1 z-30 w-44 rounded-xl border border-slate-200 bg-white shadow-lg py-1 animate-pop-in">
                  {(Object.keys(sortLabels) as SortKey[]).map((k) => (
                    <button key={k} onClick={() => { setSortKey(k); setShowSortMenu(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between ${sortKey === k ? "text-brand-600 font-medium" : "text-slate-700"}`}>
                      {sortLabels[k]}
                    </button>
                  ))}
                  <div className="h-px bg-slate-100 my-1" />
                  <button onClick={() => { setSortDir((d) => d === "asc" ? "desc" : "asc"); setShowSortMenu(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 text-slate-700 flex items-center gap-2">
                    {sortDir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                    {sortDir === "asc" ? "Ascending" : "Descending"}
                  </button>
                </div>
              )}
            </div>
            <div className="flex rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <button onClick={() => setView("list")} className={`px-3 py-2 transition-all ${view === "list" ? "bg-brand-500 text-white" : "text-slate-500 hover:bg-slate-50"}`} title="List view">
                <List className="h-4 w-4" />
              </button>
              <button onClick={() => setView("grid")} className={`px-3 py-2 border-l border-slate-200 transition-all ${view === "grid" ? "bg-brand-500 text-white" : "text-slate-500 hover:bg-slate-50"}`} title="Grid view">
                <LayoutGrid className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Selection bar */}
        {selectedCount > 0 && (
          <Card className="px-4 py-2.5 flex flex-wrap items-center gap-2 animate-pop-in border-brand-100 bg-brand-50/50">
            <span className="text-sm font-medium text-brand-700 mr-1">{selectedCount} selected</span>
            <div className="h-4 w-px bg-brand-200" />
            <Button variant="ghost" size="sm" onClick={() => void restoreSelected()}>
              <RotateCcw className="h-3.5 w-3.5" /> Restore
            </Button>
            <Button variant="danger" size="sm" onClick={() => void deleteForeverSelected()}>
              <Trash2 className="h-3.5 w-3.5" /> Delete forever
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              <X className="h-3.5 w-3.5" /> Deselect
            </Button>
          </Card>
        )}

        {/* Content */}
        <Card className="overflow-hidden">
          {loadingFiles && !data && <SkeletonList view={view} />}
          {!loadingFiles && ordered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <div className="rounded-2xl bg-slate-100 p-5 mb-4">
                <Trash2 className="h-8 w-8 text-slate-400" />
              </div>
              <p className="font-semibold text-slate-700">Trash is empty</p>
              <p className="text-sm text-slate-400 mt-1">Deleted items will appear here.</p>
            </div>
          )}

          {/* List view */}
          {ordered.length > 0 && view === "list" && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80">
                    <th className="w-10 px-4 py-3">
                      <input type="checkbox" aria-label="Select all" className="accent-brand-500 rounded"
                        checked={selectedCount === ordered.length && ordered.length > 0}
                        onChange={(e) => { setSelected(e.target.checked ? new Set(ordered.map((i) => i.id)) : new Set()); lastClicked.current = null; }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </th>
                    <th className="px-3 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wide">Name</th>
                    <th className="px-3 py-3 hidden sm:table-cell text-left font-medium text-slate-500 text-xs uppercase tracking-wide">Type</th>
                    <th className="px-3 py-3 hidden md:table-cell text-left font-medium text-slate-500 text-xs uppercase tracking-wide">Size</th>
                    <th className="px-3 py-3 hidden md:table-cell text-left font-medium text-slate-500 text-xs uppercase tracking-wide">Deleted</th>
                    <th className="w-1 px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((item, i) => {
                    const isFolder = item.mimeType === "application/vnd.google-apps.folder";
                    const isSel = selected.has(item.id);
                    return (
                      <tr
                        key={item.id}
                        onClick={(e) => handleRowClick(e, item, i)}
                        onContextMenu={(e) => handleContextMenu(e, item)}
                        className={`group border-b border-slate-50 last:border-0 cursor-pointer select-none transition-colors duration-100 ${
                          isSel ? "bg-brand-50 hover:bg-brand-100/70" : "hover:bg-slate-50"
                        }`}
                      >
                        <td className="w-10 px-4 py-2.5">
                          <input type="checkbox" aria-label={`Select ${item.name}`} className="accent-brand-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            style={isSel ? { opacity: 1 } : {}}
                            checked={isSel}
                            onChange={() => toggleSelect(item.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <FileIcon mime={item.mimeType} className="h-4 w-4 shrink-0 text-slate-400" isFolder={isFolder} />
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); router.push(`/preview?id=${item.id}`); }}
                              className="truncate font-medium text-slate-800 hover:text-brand-600 hover:underline text-left"
                              title={item.name}
                            >
                              {item.name}
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 hidden sm:table-cell text-slate-500 text-xs">{isFolder ? "Folder" : typeLabel(item.mimeType)}</td>
                        <td className="px-3 py-2.5 hidden md:table-cell text-slate-500 text-xs tabular-nums">{isFolder ? "—" : formatSize(item.size)}</td>
                        <td className="px-3 py-2.5 hidden md:table-cell text-slate-500 text-xs tabular-nums">{formatDate(item.modifiedTime)}</td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <span className="inline-flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={(e) => { e.stopPropagation(); void restoreOne(item.id); }} className="rounded-lg p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-all" title="Restore">
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); void deleteForeverOne(item.id, item.name); }} className="rounded-lg p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all" title="Delete forever">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); setPropsItem(item); }} className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all" title="Properties">
                              <Info className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Grid view */}
          {ordered.length > 0 && view === "grid" && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
              {ordered.map((item, i) => {
                const isFolder = item.mimeType === "application/vnd.google-apps.folder";
                const isSel = selected.has(item.id);
                return (
                  <div
                    key={item.id}
                    onClick={(e) => handleRowClick(e, item, i)}
                    onContextMenu={(e) => handleContextMenu(e, item)}
                    className={`group relative flex flex-col items-center rounded-2xl border p-3 cursor-pointer select-none transition-all duration-150 ${
                      isSel ? "border-brand-300 ring-2 ring-brand-200 bg-brand-50 shadow-sm" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm"
                    }`}
                  >
                    <input type="checkbox" aria-label={`Select ${item.name}`} className="accent-brand-500 absolute top-2.5 left-2.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                      style={isSel ? { opacity: 1 } : {}}
                      checked={isSel}
                      onChange={() => toggleSelect(item.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button type="button" onClick={(e) => { e.stopPropagation(); router.push(`/preview?id=${item.id}`); }} className="h-16 w-16 flex items-center justify-center mb-2 focus:outline-none" title={item.name}>
                      {!isFolder && item.thumbnailLink && item.mimeType.startsWith("image/") ? (
                        <img src={item.thumbnailLink} alt="" className="h-full w-full object-cover rounded-xl shadow-sm" loading="lazy" />
                      ) : (
                        <FileIconLarge mime={item.mimeType} isFolder={isFolder} />
                      )}
                    </button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); router.push(`/preview?id=${item.id}`); }} className="text-xs font-medium truncate w-full text-center text-slate-800 hover:text-brand-600 hover:underline leading-tight" title={item.name}>
                      {item.name}
                    </button>
                    <div className="text-xs text-slate-400 mt-0.5">{isFolder ? "Folder" : formatSize(item.size)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={[
            { label: "Open", icon: <Eye className="h-4 w-4" />, onClick: () => router.push(`/preview?id=${ctxMenu.item.id}`) },
            { label: "Restore", icon: <RotateCcw className="h-4 w-4" />, onClick: () => void restoreOne(ctxMenu.item.id) },
            { label: "Delete forever", icon: <Trash2 className="h-4 w-4" />, onClick: () => void deleteForeverOne(ctxMenu.item.id, ctxMenu.item.name), danger: true },
            { label: "Properties", icon: <Info className="h-4 w-4" />, onClick: () => setPropsItem(ctxMenu.item) },
            { label: "Share", icon: <LinkIcon className="h-4 w-4" />, onClick: () => {}, disabled: true },
            { label: "Rename", icon: <Pencil className="h-4 w-4" />, onClick: () => {}, disabled: true },
            { label: "Move", icon: <MoveRight className="h-4 w-4" />, onClick: () => {}, disabled: true },
          ]}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Properties dialog */}
      <Modal open={Boolean(propsItem)} onClose={() => setPropsItem(null)} className="max-w-sm">
        <Card className="p-5">
          <h2 className="font-semibold text-slate-900 mb-4">Properties</h2>
          {propsItem && (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Name</span>
                <span className="text-slate-900 font-medium truncate max-w-[16rem]">{propsItem.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Type</span>
                <span className="text-slate-700">{propsItem.mimeType === "application/vnd.google-apps.folder" ? "Folder" : typeLabel(propsItem.mimeType)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Size</span>
                <span className="text-slate-700">{propsItem.mimeType === "application/vnd.google-apps.folder" ? "—" : formatSize(propsItem.size)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Status</span>
                <Badge color="red" dot>In Trash</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Deleted date</span>
                <span className="text-slate-700">{formatDate(propsItem.modifiedTime)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">ID</span>
                <span className="text-slate-400 font-mono text-xs truncate max-w-[16rem]">{propsItem.id}</span>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="ghost" onClick={() => setPropsItem(null)}>Close</Button>
          </div>
        </Card>
      </Modal>

      {/* Close sort menu on outside click */}
      {showSortMenu && <div className="fixed inset-0 z-20" onClick={() => setShowSortMenu(false)} />}
    </main>
  );
}

// ── Icon helpers ─────────────────────────────────────────────────────────────

function FileIcon({ mime, isFolder, className }: { mime: string; isFolder: boolean; className?: string }) {
  if (isFolder) return <Folder className={className} />;
  if (mime.startsWith("image/")) return <ImageIcon className={className} />;
  if (mime.startsWith("video/")) return <Video className={className} />;
  if (mime.startsWith("audio/")) return <Music className={className} />;
  if (mime === "application/pdf") return <FileText className={className} />;
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/javascript") return <FileText className={className} />;
  if (mime.includes("zip") || mime.includes("compressed") || mime.includes("tar")) return <FileArchive className={className} />;
  if (mime.includes("spreadsheet") || mime === "text/csv") return <FileSpreadsheet className={className} />;
  if (mime.includes("presentation")) return <Presentation className={className} />;
  return <File className={className} />;
}

function FileIconLarge({ mime, isFolder }: { mime: string; isFolder: boolean }) {
  const cls = "h-10 w-10";
  if (isFolder) return <Folder className={`${cls} text-brand-400`} />;
  if (mime.startsWith("image/")) return <ImageIcon className={`${cls} text-violet-400`} />;
  if (mime.startsWith("video/")) return <Video className={`${cls} text-red-400`} />;
  if (mime.startsWith("audio/")) return <Music className={`${cls} text-emerald-400`} />;
  if (mime === "application/pdf") return <FileText className={`${cls} text-red-400`} />;
  if (mime.includes("spreadsheet") || mime === "text/csv") return <FileSpreadsheet className={`${cls} text-emerald-400`} />;
  if (mime.includes("presentation")) return <Presentation className={`${cls} text-amber-400`} />;
  if (mime.includes("zip") || mime.includes("compressed")) return <FileArchive className={`${cls} text-slate-400`} />;
  return <File className={`${cls} text-slate-400`} />;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function compareItems(a: DriveFile, b: DriveFile, key: SortKey, dir: SortDir): number {
  let r = 0;
  switch (key) {
    case "name": r = a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }); break;
    case "modified": { r = (Date.parse(a.modifiedTime ?? "") || 0) - (Date.parse(b.modifiedTime ?? "") || 0); break; }
    case "size": { r = (a.size ?? 0) - (b.size ?? 0); break; }
    case "type": r = typeLabel(a.mimeType).localeCompare(typeLabel(b.mimeType)); break;
  }
  return dir === "asc" ? r : -r;
}

function typeLabel(mime: string): string { return mime.split("/").pop() ?? mime; }

function formatSize(bytes: string | number | null): string {
  if (bytes == null) return "—";
  const n = typeof bytes === "string" ? Number(bytes) : bytes;
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function SkeletonList({ view }: { view: ViewMode }) {
  if (view === "grid") {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center p-3 rounded-2xl border border-slate-100 gap-2">
            <Skeleton className="h-16 w-16 rounded-xl" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="p-4 space-y-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-4 rounded" />
          <div className="h-4 flex-1 rounded animate-pulse bg-slate-100" />
        </div>
      ))}
    </div>
  );
}
