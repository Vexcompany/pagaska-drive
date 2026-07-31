"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { downloadItem } from "@/lib/download";
import type {
  DriveFile,
  DriveFolder,
  ListFilesResponse,
  SearchResponse,
  ShareStatusResponse,
} from "@pagaska/shared";

type ViewMode = "grid" | "list";
type SortKey = "name" | "modified" | "size" | "type";
type SortDir = "asc" | "desc";

const VIEW_KEY = "pagaska.view";
const SORT_KEY = "pagaska.sortKey";
const SORT_DIR_KEY = "pagaska.sortDir";

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (raw as unknown as T);
  } catch {
    return fallback;
  }
}

export default function DrivePage() {
  const { workspace, loading, logout } = useAuth();
  const router = useRouter();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [data, setData] = useState<ListFilesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [renaming, setRenaming] = useState<DriveFile | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [loadingFiles, setLoadingFiles] = useState(false);

  // Search
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);

  // Sort + view
  const [view, setView] = useState<ViewMode>(() => readLocal<ViewMode>(VIEW_KEY, "list"));
  const [sortKey, setSortKey] = useState<SortKey>(() => readLocal<SortKey>(SORT_KEY, "name"));
  const [sortDir, setSortDir] = useState<SortDir>(() => readLocal<SortDir>(SORT_DIR_KEY, "asc"));

  // Multi-selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClicked = useRef<string | null>(null);

  // Share dialog
  const [shareItem, setShareItem] = useState<DriveFile | null>(null);
  const [shareStatus, setShareStatus] = useState<ShareStatusResponse | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  // Move dialog
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTargets, setMoveTargets] = useState<string[]>([]);
  const [moveFolderId, setMoveFolderId] = useState<string | null>(null);
  const [moveFolders, setMoveFolders] = useState<DriveFolder[]>([]);
  const [moveCrumbs, setMoveCrumbs] = useState<{ id: string; name: string }[]>([]);
  const [moveBusy, setMoveBusy] = useState(false);

  const refresh = useCallback(async (id: string | null) => {
    setLoadingFiles(true);
    try {
      const next = await api.listFiles(id);
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files.");
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && !workspace) router.replace("/");
  }, [loading, workspace, router]);

  useEffect(() => {
    if (workspace) void refresh(folderId);
  }, [workspace, folderId, refresh]);

  // Persist view/sort preferences.
  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_KEY, view);
      window.localStorage.setItem(SORT_KEY, sortKey);
      window.localStorage.setItem(SORT_DIR_KEY, sortDir);
    } catch {
      /* storage unavailable */
    }
  }, [view, sortKey, sortDir]);

  // Debounced recursive search while typing.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = window.setTimeout(() => {
      api
        .search(q)
        .then((r) => setResults(r))
        .catch((err) => setError(err instanceof Error ? err.message : "Search failed."))
        .finally(() => setSearching(false));
    }, 180);
    return () => window.clearTimeout(t);
  }, [query]);

  // Clear selection when the view changes (folder navigation or search).
  useEffect(() => {
    setSelected(new Set());
    lastClicked.current = null;
  }, [folderId, query]);

  const isSearching = Boolean(query.trim()) && results !== null;

  // Sorted displayed lists (folders first, then files).
  const folders = useMemo(() => {
    const src: DriveFile[] = results ? results.folders : (data?.folders ?? []);
    return [...src].sort((a, b) => compareItems(a, b, sortKey, sortDir));
  }, [results, data, sortKey, sortDir]);

  const files = useMemo(() => {
    const src: DriveFile[] = results ? results.files : (data?.files ?? []);
    return [...src].sort((a, b) => compareItems(a, b, sortKey, sortDir));
  }, [results, data, sortKey, sortDir]);

  const ordered = useMemo(() => [...folders, ...files], [folders, files]);

  // ---------------------------------------------------------------- actions

  async function createFolder() {
    if (!newFolderName.trim()) return;
    try {
      await api.createFolder({ name: newFolderName.trim(), parentId: folderId });
      setNewFolderName("");
      void refresh(folderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder.");
    }
  }

  async function deleteOne(id: string) {
    if (!confirm("Delete this item? This cannot be undone.")) return;
    try {
      await api.deleteFile(id);
      void refresh(folderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} item${ids.length > 1 ? "s" : ""}? This cannot be undone.`)) return;
    try {
      for (const id of ids) await api.deleteFile(id);
      setSelected(new Set());
      void refresh(folderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  async function downloadSelected() {
    for (const item of ordered) {
      if (!selected.has(item.id)) continue;
      try {
        await downloadItem(item);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to download ${item.name}.`);
      }
    }
  }

  async function submitRename() {
    if (!renaming || !renameValue.trim()) return;
    try {
      await api.rename({ fileId: renaming.id, name: renameValue.trim() });
      setRenaming(null);
      setRenameValue("");
      void refresh(folderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed.");
    }
  }

  // ---------------------------------------------------------------- selection

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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

  function handleItemClick(e: React.MouseEvent, item: DriveFile, index: number) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      toggleSelect(item.id);
      return;
    }
    if (e.shiftKey && lastClicked.current) {
      e.preventDefault();
      selectRange(lastClicked.current, item.id);
      return;
    }
    if (item.mimeType === "application/vnd.google-apps.folder") {
      setFolderId(item.id);
    } else {
      router.push(`/preview?id=${item.id}`);
    }
  }

  // ---------------------------------------------------------------- share dialog

  async function openShare(item: DriveFile) {
    setShareItem(item);
    setShareStatus(null);
    setShareCopied(false);
    try {
      const status = await api.shareStatus(item.id);
      setShareStatus(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load share status.");
      setShareItem(null);
    }
  }

  async function makePublic() {
    if (!shareItem || shareBusy) return;
    setShareBusy(true);
    try {
      const { webViewLink } = await api.share(shareItem.id);
      setShareStatus({ public: true, role: "reader", webViewLink });
    } catch (err) {
      setShareStatus((prev) => ({ ...(prev ?? { public: false, role: null, webViewLink: null }), public: false }));
      setError(err instanceof Error ? err.message : "Share failed.");
    } finally {
      setShareBusy(false);
    }
  }

  async function copyShareLink() {
    if (!shareStatus?.webViewLink) return;
    try {
      await navigator.clipboard.writeText(shareStatus.webViewLink);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", shareStatus.webViewLink);
    }
  }

  // Esc closes any open dialog.
  useEffect(() => {
    if (!shareItem && !renaming && !moveOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShareItem(null);
        setRenaming(null);
        setMoveOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shareItem, renaming, moveOpen]);

  // ---------------------------------------------------------------- move dialog

  function openMove() {
    setMoveTargets([...selected]);
    setMoveFolderId(null);
    setMoveCrumbs([]);
    setMoveOpen(true);
  }

  useEffect(() => {
    if (!moveOpen) return;
    let alive = true;
    api
      .listFiles(moveFolderId)
      .then((next) => {
        if (alive) {
          setMoveFolders(next.folders);
          setMoveCrumbs(next.breadcrumb);
        }
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "Failed to load folders.");
      });
    return () => {
      alive = false;
    };
  }, [moveOpen, moveFolderId]);

  async function confirmMove() {
    if (moveBusy) return;
    setMoveBusy(true);
    try {
      await api.move({ fileIds: moveTargets, parentId: moveFolderId });
      setMoveOpen(false);
      setSelected(new Set());
      void refresh(folderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Move failed.");
    } finally {
      setMoveBusy(false);
    }
  }

  if (!workspace) return null;

  const selectedCount = selected.size;
  const searchQuery = query.trim();

  return (
    <main className="min-h-screen p-4 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">Pagaska Drive <span className="text-slate-400">/ {workspace}</span></h1>
          <nav className="text-sm text-slate-500 mt-1 flex items-center gap-1 flex-wrap" aria-label="Breadcrumb">
            <button
              onClick={() => { setFolderId(null); setQuery(""); }}
              className={`hover:text-brand-600 ${folderId === null && !searchQuery ? "font-semibold text-slate-700" : "hover:underline"}`}
            >
              Home
            </button>
            {!searchQuery &&
              data?.breadcrumb.map((c) => (
                <span key={c.id} className="flex items-center gap-1">
                  <span className="text-slate-300">›</span>
                  <button onClick={() => setFolderId(c.id)} className="hover:text-brand-600 hover:underline">
                    {c.name}
                  </button>
                </span>
              ))}
            {searchQuery && (
              <span className="flex items-center gap-1">
                <span className="text-slate-300">›</span>
                <span className="text-slate-700">Search: “{searchQuery}”</span>
              </span>
            )}
          </nav>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-lg ring-1 ring-slate-200 overflow-hidden">
            <button
              onClick={() => setView("list")}
              className={`px-3 py-2 text-sm ${view === "list" ? "bg-brand-500 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
              title="List view"
            >
              ☰
            </button>
            <button
              onClick={() => setView("grid")}
              className={`px-3 py-2 text-sm ${view === "grid" ? "bg-brand-500 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
              title="Grid view"
            >
              ▦
            </button>
          </div>
          <Link className="btn-ghost" href="/upload">Upload</Link>
          <Link className="btn-ghost" href="/profile">Switch workspace</Link>
          <button onClick={logout} className="btn-ghost">Sign out</button>
        </div>
      </header>

      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      {/* Toolbar: search + sort + new folder */}
      <section className="card p-3 mb-4">
        <div className="flex flex-col md:flex-row gap-2">
          <div className="relative flex-1">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files and folders…"
              className="input pl-9"
              aria-label="Search"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            {searching && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2 border-slate-300 border-t-brand-500 animate-spin" />
            )}
            {searchQuery && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="input w-auto"
              aria-label="Sort by"
            >
              <option value="name">Name</option>
              <option value="modified">Date modified</option>
              <option value="size">Size</option>
              <option value="type">Type</option>
            </select>
            <button
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              className="btn-ghost w-10"
              title={sortDir === "asc" ? "Ascending" : "Descending"}
            >
              {sortDir === "asc" ? "↑" : "↓"}
            </button>
          </div>
          <div className="flex gap-2">
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void createFolder(); }}
              placeholder="New folder name"
              className="input"
              aria-label="New folder name"
            />
            <button onClick={() => void createFolder()} className="btn-primary whitespace-nowrap">Create folder</button>
          </div>
        </div>
      </section>

      {/* Selection action bar */}
      {selectedCount > 0 && (
        <section className="card p-3 mb-4 flex flex-wrap items-center gap-2 animate-pop-in">
          <span className="text-sm font-medium text-slate-700 mr-1">
            {selectedCount} selected
          </span>
          <button onClick={() => void deleteSelected()} className="btn-ghost text-xs text-red-600">Delete</button>
          <button onClick={() => void downloadSelected()} className="btn-ghost text-xs">Download</button>
          <button
            onClick={() => { const only = ordered.find((i) => selected.has(i.id)); if (only) void openShare(only); }}
            disabled={selectedCount !== 1}
            className="btn-ghost text-xs disabled:opacity-40"
            title={selectedCount !== 1 ? "Select exactly one item to share" : "Share"}
          >
            Share
          </button>
          <button onClick={openMove} className="btn-ghost text-xs">Move</button>
          <button onClick={() => setSelected(new Set())} className="btn-ghost text-xs">Clear selection</button>
        </section>
      )}

      {/* Content */}
      <section className="card overflow-hidden">
        {loadingFiles && !data && <SkeletonList view={view} />}
        {!loadingFiles && ordered.length === 0 && (
          <EmptyState
            searching={Boolean(searchQuery)}
            query={searchQuery}
            atRoot={folderId === null}
            onClear={() => setQuery("")}
          />
        )}
        {ordered.length > 0 && view === "list" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      className="accent-brand-500"
                      checked={selectedCount === ordered.length && ordered.length > 0}
                      onChange={(e) => {
                        setSelected(e.target.checked ? new Set(ordered.map((i) => i.id)) : new Set());
                        lastClicked.current = null;
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2 hidden sm:table-cell">Type</th>
                  <th className="px-3 py-2 hidden md:table-cell">Size</th>
                  <th className="px-3 py-2 hidden md:table-cell">Modified</th>
                  <th className="px-3 py-2 w-1"></th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((item, i) => {
                  const isFolder = item.mimeType === "application/vnd.google-apps.folder";
                  const isSel = selected.has(item.id);
                  return (
                    <tr
                      key={item.id}
                      onClick={(e) => handleItemClick(e, item, i)}
                      className={`border-t border-slate-100 hover:bg-slate-50 cursor-pointer select-none ${isSel ? "bg-brand-50" : ""}`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.name}`}
                          className="accent-brand-500"
                          checked={isSel}
                          onChange={() => toggleSelect(item.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-lg shrink-0">{isFolder ? "📁" : fileIcon(item.mimeType)}</span>
                          <span className="truncate">{item.name}</span>
                          {isSearching && (item as DriveFile & { path?: string | null }).path && (
                            <span className="text-xs text-slate-400 truncate">· {(item as DriveFile & { path?: string | null }).path}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 hidden sm:table-cell text-slate-500">{isFolder ? "folder" : typeLabel(item.mimeType)}</td>
                      <td className="px-3 py-2 hidden md:table-cell text-slate-500">{isFolder ? "—" : formatSize(item.size)}</td>
                      <td className="px-3 py-2 hidden md:table-cell text-slate-500">{formatDate(item.modifiedTime)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          onClick={(e) => { e.stopPropagation(); setRenaming(item); setRenameValue(item.name); }}
                          className="btn-ghost text-xs"
                        >
                          rename
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); void openShare(item); }} className="btn-ghost text-xs">share</button>
                        <button onClick={(e) => { e.stopPropagation(); void deleteOne(item.id); }} className="btn-ghost text-xs text-red-600">delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {ordered.length > 0 && view === "grid" && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 p-3">
            {ordered.map((item, i) => {
              const isFolder = item.mimeType === "application/vnd.google-apps.folder";
              const isSel = selected.has(item.id);
              return (
                <div
                  key={item.id}
                  onClick={(e) => handleItemClick(e, item, i)}
                  className={`relative rounded-xl border p-2 cursor-pointer select-none transition group ${
                    isSel ? "border-brand-500 ring-2 ring-brand-200 bg-brand-50" : "border-slate-200 hover:border-brand-300 hover:shadow-sm"
                  }`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.name}`}
                    className="accent-brand-500 absolute top-2 left-2 z-10"
                    checked={isSel}
                    onChange={() => toggleSelect(item.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="h-20 flex items-center justify-center text-4xl">
                    {isFolder ? "📁" : item.thumbnailLink && item.mimeType.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.thumbnailLink} alt="" className="h-16 w-16 object-cover rounded-lg" loading="lazy" />
                    ) : (
                      <span>{fileIcon(item.mimeType)}</span>
                    )}
                  </div>
                  <div className="text-sm font-medium truncate text-center mt-1" title={item.name}>
                    {item.name}
                  </div>
                  <div className="text-xs text-slate-400 text-center">
                    {isFolder ? "Folder" : `${typeLabel(item.mimeType)} · ${formatSize(item.size)}`}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Rename modal */}
      {renaming && (
        <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-6" role="dialog" onClick={() => setRenaming(null)}>
          <div className="card w-full max-w-sm p-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold mb-2">Rename</h2>
            <input
              className="input mb-3"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submitRename(); }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRenaming(null)} className="btn-ghost">Cancel</button>
              <button onClick={() => void submitRename()} className="btn-primary">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Share dialog */}
      {shareItem && (
        <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-4" role="dialog" onClick={() => setShareItem(null)}>
          <div className="card w-full max-w-md p-5 animate-pop-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="font-semibold">Share</h2>
                <p className="text-sm text-slate-500 truncate max-w-[16rem]">{shareItem.name}</p>
              </div>
              <button onClick={() => setShareItem(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none" aria-label="Close">
                ✕
              </button>
            </div>

            {!shareStatus ? (
              <div className="flex items-center gap-2 text-sm text-slate-400 py-6">
                <span className="h-4 w-4 rounded-full border-2 border-slate-300 border-t-brand-500 animate-spin" />
                Checking link sharing…
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-slate-200 p-3 mb-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">Anyone with the link</div>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        shareStatus.public ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${shareStatus.public ? "bg-green-500" : "bg-slate-400"}`} />
                      {shareStatus.public ? "Public" : "Restricted"}
                    </span>
                  </div>
                  {!shareStatus.public ? (
                    <button onClick={() => void makePublic()} disabled={shareBusy} className="btn-primary mt-3 text-xs">
                      {shareBusy ? "Turning on…" : "Turn on link sharing"}
                    </button>
                  ) : (
                    <div className="flex items-center justify-between mt-3 gap-2">
                      <div className="text-xs text-slate-500">Role: <span className="font-medium text-slate-700">{shareStatus.role === "reader" ? "Viewer" : shareStatus.role ?? "Viewer"}</span></div>
                      <button
                        onClick={() => void copyShareLink()}
                        disabled={!shareStatus.webViewLink}
                        className="btn-primary text-xs"
                      >
                        {shareCopied ? <span className="inline-flex items-center gap-1 animate-pop-in">✓ Copied</span> : "Copy Link"}
                      </button>
                    </div>
                  )}
                </div>
                {shareStatus.public && shareStatus.webViewLink && (
                  <p className="text-xs text-slate-400 break-all mb-3">{shareStatus.webViewLink}</p>
                )}
                <div className="flex justify-end">
                  <button onClick={() => setShareItem(null)} className="btn-ghost">Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Move dialog */}
      {moveOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-4" role="dialog" onClick={() => setMoveOpen(false)}>
          <div className="card w-full max-w-md p-5 animate-pop-in" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold mb-1">Move</h2>
            <p className="text-sm text-slate-500 mb-3">
              {moveTargets.length} item{moveTargets.length > 1 ? "s" : ""} → choose a destination folder
            </p>

            <nav className="flex items-center gap-1 text-sm text-slate-500 mb-3 flex-wrap" aria-label="Move destination">
              <button
                onClick={() => { setMoveFolderId(null); setMoveCrumbs([]); }}
                className={`hover:underline ${moveFolderId === null ? "font-semibold text-slate-700" : "hover:text-brand-600"}`}
              >
                Home
              </button>
              {moveCrumbs.map((c) => (
                <span key={c.id} className="flex items-center gap-1">
                  <span className="text-slate-300">›</span>
                  <button
                    onClick={() => { setMoveFolderId(c.id); }}
                    className={`hover:underline ${moveFolderId === c.id ? "font-semibold text-slate-700" : "hover:text-brand-600"}`}
                  >
                    {c.name}
                  </button>
                </span>
              ))}
            </nav>

            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
              {moveFolders.length === 0 && (
                <div className="text-sm text-slate-400 p-4">No subfolders here.</div>
              )}
              {moveFolders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setMoveFolderId(f.id)}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-sm"
                >
                  <span>📁</span>
                  <span className="truncate">{f.name}</span>
                </button>
              ))}
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setMoveOpen(false)} className="btn-ghost">Cancel</button>
              <button onClick={() => void confirmMove()} disabled={moveBusy} className="btn-primary">
                {moveBusy ? "Moving…" : "Move here"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Helpers

function compareItems(a: DriveFile, b: DriveFile, key: SortKey, dir: SortDir): number {
  let r = 0;
  switch (key) {
    case "name":
      r = a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
      break;
    case "modified": {
      const ta = Date.parse(a.modifiedTime ?? "") || 0;
      const tb = Date.parse(b.modifiedTime ?? "") || 0;
      r = ta - tb;
      break;
    }
    case "size": {
      const na = typeof a.size === "string" ? Number(a.size) : a.size ?? 0;
      const nb = typeof b.size === "string" ? Number(b.size) : b.size ?? 0;
      r = (na || 0) - (nb || 0);
      break;
    }
    case "type":
      r = typeLabel(a.mimeType).localeCompare(typeLabel(b.mimeType));
      break;
  }
  return dir === "asc" ? r : -r;
}

function typeLabel(mime: string): string {
  return mime.split("/").pop() ?? mime;
}

function fileIcon(mime: string): string {
  if (mime.startsWith("image/")) return "🖼️";
  if (mime.startsWith("video/")) return "🎬";
  if (mime.startsWith("audio/")) return "🎵";
  if (mime === "application/pdf") return "📕";
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml" || mime === "application/javascript") return "📄";
  if (mime.includes("zip") || mime.includes("compressed") || mime.includes("tar")) return "🗜️";
  if (mime.includes("spreadsheet") || mime === "text/csv") return "📊";
  if (mime.includes("presentation")) return "📽️";
  return "📄";
}

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
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 p-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-100 p-2">
            <div className="h-20 rounded-lg bg-slate-100 animate-pulse" />
            <div className="h-3 rounded bg-slate-100 animate-pulse mt-2 w-3/4 mx-auto" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="p-3 space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-10 rounded-lg bg-slate-100 animate-pulse" />
      ))}
    </div>
  );
}

function EmptyState({ searching, query, atRoot, onClear }: { searching: boolean; query: string; atRoot: boolean; onClear: () => void }) {
  return (
    <div className="text-center py-16 px-6">
      {searching ? (
        <>
          <div className="text-5xl mb-3">🔍</div>
          <p className="text-slate-500 font-medium">No results for “{query}”</p>
          <p className="text-sm text-slate-400 mt-1">Try a different name or check the spelling.</p>
          <button onClick={onClear} className="btn-ghost mt-4 text-sm">Clear search</button>
        </>
      ) : atRoot ? (
        <>
          <div className="text-5xl mb-3">🗂️</div>
          <p className="text-slate-500 font-medium">No files uploaded yet</p>
          <p className="text-sm text-slate-400 mt-1">Upload a file or create a folder to get started.</p>
          <Link href="/upload" className="btn-primary mt-4 text-sm">Upload files</Link>
        </>
      ) : (
        <>
          <div className="text-5xl mb-3">📂</div>
          <p className="text-slate-500 font-medium">This folder is empty</p>
          <p className="text-sm text-slate-400 mt-1">Upload files here or create a subfolder.</p>
          <Link href="/upload" className="btn-ghost mt-4 text-sm">Upload files</Link>
        </>
      )}
    </div>
  );
}
