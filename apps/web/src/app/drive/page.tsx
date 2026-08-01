"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api, batchOperation, MAX_BATCH, type BatchProgress } from "@/lib/api";
import { downloadSelected } from "@/lib/download";
import { formatSize, formatDate, typeLabel } from "@/lib/format";
import { addFilesToPanel, useUploadCompletionVersion } from "@/hooks/useUploadPanel";
import { setFolderCover, removeCoverByImage, getFolderCover, useFolderCoverVersion } from "@/stores/useFolderCoverStore";
import { showToast } from "@/stores/useToastStore";
import { FolderCoverImage, getFolderCoverUrl } from "@/components/FolderCoverImage";
import { FolderStatsDisplay } from "@/components/FolderStatsDisplay";
import { PropertiesPanel } from "@/components/PropertiesPanel";
import {
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
  LayoutGrid,
  List,
  Upload,
  User,
  LogOut,
  Trash2,
  Download,
  Link as LinkIcon,
  Pencil,
  FolderOpen,
  FolderPlus,
  MoveRight,
  Check,
  TriangleAlert,
  House,
  ChevronRight,
  Loader2,
  SlidersHorizontal,
  Info,
  ImagePlus,
  CloudUpload,
  Eye,
} from "lucide-react";
import {
  Button,
  Badge,
  Card,
  Spinner,
  Skeleton,
  Modal,
  ErrorBanner,
  Toast,
  ContextMenu,
} from "@/components/ui";
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
const SCROLL_KEY = "pagaska.scrollY";

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
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand-400" />
      </main>
    }>
      <DriveInner />
    </Suspense>
  );
}

function DriveInner() {
  const { workspace, loading, logout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read folderId from URL – null means root
  const folderId = useMemo(() => searchParams.get("folderId") ?? null, [searchParams]);

  const [data, setData] = useState<ListFilesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [renaming, setRenaming] = useState<DriveFile | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);

  const [view, setView] = useState<ViewMode>(() => readLocal<ViewMode>(VIEW_KEY, "list"));
  const [sortKey, setSortKey] = useState<SortKey>(() => readLocal<SortKey>(SORT_KEY, "name"));
  const [sortDir, setSortDir] = useState<SortDir>(() => readLocal<SortDir>(SORT_DIR_KEY, "asc"));
  const [showSortMenu, setShowSortMenu] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClicked = useRef<string | null>(null);

  const [shareItem, setShareItem] = useState<DriveFile | null>(null);
  const [shareStatus, setShareStatus] = useState<ShareStatusResponse | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTargets, setMoveTargets] = useState<string[]>([]);
  const [moveFolderId, setMoveFolderId] = useState<string | null>(null);
  const [moveFolders, setMoveFolders] = useState<DriveFolder[]>([]);
  const [moveCrumbs, setMoveCrumbs] = useState<{ id: string; name: string }[]>([]);
  const [moveBusy, setMoveBusy] = useState(false);

  // Properties panel
  const [propsItem, setPropsItem] = useState<DriveFile | null>(null);

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; item: DriveFile } | null>(null);

  // Upload drag state
  const [dragOver, setDragOver] = useState(false);

  // Re-render when folder cover store changes
  useFolderCoverVersion();

  // ── Undo toast for "Move to Trash" ──────────────────────────────────────
  const [toast, setToast] = useState<{ visible: boolean; message: string; undoIds: string[]; restoring: boolean }>({
    visible: false,
    message: "",
    undoIds: [],
    restoring: false,
  });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showTrashToast(ids: string[], count: number) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ visible: true, message: `${count} item${count > 1 ? "s" : ""} moved to Trash`, undoIds: ids, restoring: false });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, visible: false })), 6000);
  }

  async function undoTrash() {
    const ids = toast.undoIds;
    if (ids.length === 0 || toast.restoring) return;
    setToast((t) => ({ ...t, restoring: true }));
    try {
      await api.restoreItems({ fileIds: ids });
      setToast({ visible: false, message: "", undoIds: [], restoring: false });
      showToast("Restored successfully");
      void refresh(folderId);
    } catch (err) {
      setToast((t) => ({ ...t, restoring: false }));
      showToast("Restore failed", { type: "error" });
    }
  }

  // ── Helpers: URL-based navigation ───────────────────────────────────────

  function navigateToFolder(id: string | null) {
    router.push(id ? `/drive?folderId=${id}` : "/drive");
  }

  function openItem(item: DriveFile) {
    if (item.mimeType === "application/vnd.google-apps.folder") {
      navigateToFolder(item.id);
    } else {
      try { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY)); } catch { /* */ }
      const folderParam = folderId ? `&folderId=${encodeURIComponent(folderId)}` : "";
      router.push(`/preview?id=${encodeURIComponent(item.id)}${folderParam}`);
    }
  }

  // ── Data fetching ───────────────────────────────────────────────────────

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

  // Silent refresh — used when uploads complete.  Re-fetches the file
  // listing without showing a loading skeleton so the current scroll
  // position and selection are preserved.
  const silentRefresh = useCallback(async (id: string | null) => {
    try {
      const next = await api.listFiles(id);
      setData(next);
    } catch {
      // Don't surface errors for background refresh — the current data
      // is still valid and the user can always manually refresh.
    }
  }, []);

  useEffect(() => {
    if (!loading && !workspace) router.replace("/");
  }, [loading, workspace, router]);

  useEffect(() => {
    if (workspace) void refresh(folderId);
  }, [workspace, folderId, refresh]);

  // ── Auto-refresh when uploads complete ─────────────────────────────────
  // Watches the completion version for the current folder.  When uploads
  // finish, silently re-fetches the directory listing so new files appear
  // without a full page reload.  Scroll position and selection are
  // preserved because we don't show a loading skeleton.
  const uploadCompletionVersion = useUploadCompletionVersion(folderId);
  const prevUploadVersion = useRef(uploadCompletionVersion);
  const prevUploadFolderId = useRef(folderId);

  useEffect(() => {
    // If the user navigated to a different folder, just sync the refs
    // without triggering a refresh.
    if (folderId !== prevUploadFolderId.current) {
      prevUploadFolderId.current = folderId;
      prevUploadVersion.current = uploadCompletionVersion;
      return;
    }

    // Version increased ⇒ uploads completed for the current folder.
    if (uploadCompletionVersion > 0 && uploadCompletionVersion > prevUploadVersion.current) {
      prevUploadVersion.current = uploadCompletionVersion;
      // Save scroll position, refresh, then restore.
      const scrollY = window.scrollY;
      void silentRefresh(folderId).then(() => {
        window.scrollTo(0, scrollY);
      });
    }
  }, [uploadCompletionVersion, folderId, silentRefresh]);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SCROLL_KEY);
      if (saved != null) {
        sessionStorage.removeItem(SCROLL_KEY);
        const y = Number(saved);
        if (Number.isFinite(y)) window.scrollTo(0, y);
      }
    } catch { /* */ }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_KEY, view);
      window.localStorage.setItem(SORT_KEY, sortKey);
      window.localStorage.setItem(SORT_DIR_KEY, sortDir);
    } catch { /* storage unavailable */ }
  }, [view, sortKey, sortDir]);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); setSearching(false); return; }
    setSearching(true);
    const t = window.setTimeout(() => {
      api.search(q)
        .then((r) => setResults(r))
        .catch((err) => setError(err instanceof Error ? err.message : "Search failed."))
        .finally(() => setSearching(false));
    }, 180);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setSelected(new Set());
    lastClicked.current = null;
  }, [folderId, query]);

  const isSearching = Boolean(query.trim()) && results !== null;

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

  async function createFolder() {
    if (!newFolderName.trim()) return;
    try {
      await api.createFolder({ name: newFolderName.trim(), parentId: folderId });
      setNewFolderName("");
      setShowNewFolder(false);
      showToast("Folder created");
      void refresh(folderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder.");
    }
  }

  async function deleteOne(id: string) {
    try {
      await api.deleteFile(id);
      showTrashToast([id], 1);
      void refresh(folderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      const result = await batchOperation(
        ids,
        async (chunk) => {
          const res = await api.trashItems({ fileIds: chunk });
          return { succeeded: res.trashed, failed: res.failed ?? [] };
        },
      );
      setSelected(new Set());
      if (result.failed.length > 0) {
        setError(`${result.failed.length} item(s) could not be moved to trash.`);
      }
      showTrashToast(result.succeeded, result.succeeded.length);
      void refresh(folderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  async function handleDownloadSelected() {
    const items = ordered.filter((i) => selected.has(i.id));
    if (items.length === 0) return;
    try {
      await downloadSelected(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    }
  }

  async function submitRename() {
    if (!renaming || !renameValue.trim()) return;
    try {
      await api.rename({ fileId: renaming.id, name: renameValue.trim() });
      setRenaming(null);
      setRenameValue("");
      showToast("Renamed successfully");
      void refresh(folderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed.");
    }
  }

  // ── Upload handling ─────────────────────────────────────────────────────

  function handleUploadFiles(fileList: FileList | File[]) {
    const rawFiles = Array.from(fileList);
    if (rawFiles.length === 0) return;
    addFilesToPanel(rawFiles, folderId);
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    handleUploadFiles(list);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const rawFiles: File[] = [];
    const items = e.dataTransfer.items;
    if (items && items.length && "webkitGetAsEntry" in items[0]) {
      const entries: PagaskaFsEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.() as PagaskaFsEntry | null;
        if (entry) entries.push(entry);
      }
      collectEntries(entries, rawFiles).then(() => {
        if (rawFiles.length > 0) addFilesToPanel(rawFiles, folderId);
      });
    } else {
      handleUploadFiles(e.dataTransfer.files);
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

  // ── Share ───────────────────────────────────────────────────────────────

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
      showToast("Share link created");
    } catch (err) {
      setShareStatus((prev: ShareStatusResponse | null) => ({ ...(prev ?? { public: false, role: null, webViewLink: null }), public: false }));
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
      showToast("Link copied");
      window.setTimeout(() => setShareCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", shareStatus.webViewLink);
    }
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      const isModal = Boolean(shareItem || renaming || moveOpen || propsItem);
      if (isInput || isModal) {
        if (e.key === "Escape" && isModal) {
          e.preventDefault();
          setShareItem(null);
          setRenaming(null);
          setMoveOpen(false);
          setPropsItem(null);
        }
        return;
      }
      if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSelected(new Set(ordered.map((i) => i.id)));
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSelected(new Set());
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selected.size > 0) { e.preventDefault(); void deleteSelected(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ordered, selected, shareItem, renaming, moveOpen, propsItem]);

  // ── Move ────────────────────────────────────────────────────────────────

  function openMove() {
    setMoveTargets([...selected] as string[]);
    setMoveFolderId(null);
    setMoveCrumbs([]);
    setMoveOpen(true);
  }

  useEffect(() => {
    if (!moveOpen) return;
    let alive = true;
    api.listFiles(moveFolderId)
      .then((next) => { if (alive) { setMoveFolders(next.folders); setMoveCrumbs(next.breadcrumb); } })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : "Failed to load folders."); });
    return () => { alive = false; };
  }, [moveOpen, moveFolderId]);

  async function confirmMove() {
    if (moveBusy) return;
    setMoveBusy(true);
    try {
      await api.move({ fileIds: moveTargets, parentId: moveFolderId });
      setMoveOpen(false);
      setSelected(new Set());
      showToast("Moved successfully");
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

  const sortLabels: Record<SortKey, string> = {
    name: "Name",
    modified: "Date modified",
    size: "File size",
    type: "File type",
  };

  // Build context menu items
  const ctxMenuItems = ctxMenu ? [
    { label: "Open", icon: <Eye className="h-4 w-4" />, onClick: () => openItem(ctxMenu.item) },
    { label: "Rename", icon: <Pencil className="h-4 w-4" />, onClick: () => { setRenaming(ctxMenu.item); setRenameValue(ctxMenu.item.name); } },
    { label: "Share", icon: <LinkIcon className="h-4 w-4" />, onClick: () => void openShare(ctxMenu.item) },
    { label: "Move", icon: <MoveRight className="h-4 w-4" />, onClick: () => { setMoveTargets([ctxMenu.item.id]); setMoveOpen(true); } },
    { label: "Download", icon: <Download className="h-4 w-4" />, onClick: () => void downloadSelected([ctxMenu.item]) },
    { label: "Properties", icon: <Info className="h-4 w-4" />, onClick: () => setPropsItem(ctxMenu.item) },
    // Set as Folder Cover — only for images
    ...(ctxMenu.item.mimeType.startsWith("image/") && ctxMenu.item.thumbnailLink && folderId ? [{
      label: "Set as Folder Cover", icon: <ImagePlus className="h-4 w-4" />, onClick: () => {
        setFolderCover(folderId, ctxMenu.item.id, ctxMenu.item.thumbnailLink!);
        showToast("Folder cover updated");
      }
    }] : []),
    { label: "Move to Trash", icon: <Trash2 className="h-4 w-4" />, onClick: () => void deleteOne(ctxMenu.item.id), danger: true },
  ] : [];

  return (
    <main
      className="min-h-screen bg-slate-50"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {/* Upload drop overlay */}
      {dragOver && (
        <div className="fixed inset-0 z-50 bg-brand-500/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="rounded-2xl bg-white p-8 shadow-2xl flex flex-col items-center gap-3 animate-pop-in">
            <CloudUpload className="h-10 w-10 text-brand-500" />
            <p className="text-lg font-semibold text-slate-900">Drop files to upload</p>
            <p className="text-sm text-slate-400">Files will be uploaded to the current folder</p>
          </div>
        </div>
      )}

      {/* Top nav */}
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              onClick={() => { navigateToFolder(null); setQuery(""); }}
              className="flex items-center gap-2 text-brand-600 hover:text-brand-700 font-semibold shrink-0"
            >
              <House className="h-4 w-4" />
              <span className="hidden sm:inline text-sm">Drive</span>
            </button>
            {!searchQuery && data?.breadcrumb.map((c: { id: string; name: string }) => (
              <span key={c.id} className="flex items-center gap-1 min-w-0">
                <ChevronRight className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                <button
                  onClick={() => navigateToFolder(c.id)}
                  className="text-sm text-slate-600 hover:text-slate-900 truncate max-w-[8rem]"
                >
                  {c.name}
                </button>
              </span>
            ))}
            {searchQuery && (
              <span className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                <span className="text-sm text-slate-600 truncate">&quot;{searchQuery}&quot;</span>
              </span>
            )}
          </div>

          {/* Folder stats */}
          {data && !searchQuery && (
            <FolderStatsDisplay files={data.files} folders={data.folders} className="hidden lg:inline" />
          )}

          <span className="hidden md:flex items-center gap-1.5 text-xs text-slate-500 shrink-0">
            <User className="h-3.5 w-3.5" />
            {workspace}
          </span>

          <div className="flex items-center gap-1 shrink-0">
            <Link href="/trash" className="inline-flex items-center gap-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all">
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Trash</span>
            </Link>
            <Link href={folderId ? `/upload?folderId=${encodeURIComponent(folderId)}` : "/upload"} className="inline-flex items-center gap-1.5 bg-brand-500 text-white hover:bg-brand-600 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all shadow-sm">
              <Upload className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Upload</span>
            </Link>
            <Link href="/profile" className="inline-flex items-center gap-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all">
              <User className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Workspace</span>
            </Link>
            <button
              onClick={logout}
              className="inline-flex items-center gap-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
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
              placeholder="Search files and folders…"
              className="w-full pl-9 pr-10 py-2 text-sm rounded-xl border border-slate-200 bg-white shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 transition-all placeholder:text-slate-400"
              aria-label="Search"
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-brand-400 animate-spin" />
            )}
            {searchQuery && !searching && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                title="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex gap-2 items-center">
            <div className="relative">
              <button
                onClick={() => setShowSortMenu((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 transition-all"
              >
                <SlidersHorizontal className="h-4 w-4 text-slate-400" />
                <span className="hidden sm:inline">{sortLabels[sortKey]}</span>
                {sortDir === "asc" ? (
                  <ArrowUp className="h-3.5 w-3.5 text-slate-400" />
                ) : (
                  <ArrowDown className="h-3.5 w-3.5 text-slate-400" />
                )}
              </button>
              {showSortMenu && (
                <div className="absolute right-0 top-full mt-1 z-30 w-44 rounded-xl border border-slate-200 bg-white shadow-lg py-1 animate-pop-in">
                  {(Object.keys(sortLabels) as SortKey[]).map((k) => (
                    <button
                      key={k}
                      onClick={() => { setSortKey(k); setShowSortMenu(false); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between ${sortKey === k ? "text-brand-600 font-medium" : "text-slate-700"}`}
                    >
                      {sortLabels[k]}
                      {sortKey === k && <Check className="h-4 w-4" />}
                    </button>
                  ))}
                  <div className="h-px bg-slate-100 my-1" />
                  <button
                    onClick={() => { setSortDir((d) => d === "asc" ? "desc" : "asc"); setShowSortMenu(false); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 text-slate-700 flex items-center gap-2"
                  >
                    {sortDir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                    {sortDir === "asc" ? "Ascending" : "Descending"}
                  </button>
                </div>
              )}
            </div>

            <div className="flex rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <button
                onClick={() => setView("list")}
                className={`px-3 py-2 transition-all ${view === "list" ? "bg-brand-500 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                title="List view"
              >
                <List className="h-4 w-4" />
              </button>
              <button
                onClick={() => setView("grid")}
                className={`px-3 py-2 border-l border-slate-200 transition-all ${view === "grid" ? "bg-brand-500 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                title="Grid view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
            </div>

            <button
              onClick={() => setShowNewFolder((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 transition-all"
              title="New folder"
            >
              <FolderPlus className="h-4 w-4 text-slate-400" />
              <span className="hidden sm:inline">New folder</span>
            </button>
          </div>
        </div>

        {/* New folder inline */}
        {showNewFolder && (
          <Card className="p-3 animate-pop-in">
            <div className="flex gap-2 items-center">
              <Folder className="h-4 w-4 text-slate-400 shrink-0" />
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void createFolder(); if (e.key === "Escape") setShowNewFolder(false); }}
                placeholder="Folder name"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200"
                autoFocus
                aria-label="New folder name"
              />
              <Button variant="primary" size="sm" onClick={() => void createFolder()}>Create</Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowNewFolder(false); setNewFolderName(""); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        )}

        {/* Selection bar */}
        {selectedCount > 0 && (
          <Card className="px-4 py-2.5 flex flex-wrap items-center gap-2 animate-pop-in border-brand-100 bg-brand-50/50">
            <span className="text-sm font-medium text-brand-700 mr-1">
              {selectedCount} selected
            </span>
            <div className="h-4 w-px bg-brand-200" />
            <Button variant="danger" size="sm" onClick={() => void deleteSelected()}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void handleDownloadSelected()}>
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { const only = ordered.find((i) => selected.has(i.id)); if (only) void openShare(only); }}
              disabled={selectedCount !== 1}
              title={selectedCount !== 1 ? "Select exactly one item to share" : "Share"}
            >
              <LinkIcon className="h-3.5 w-3.5" />
              Share
            </Button>
            <Button variant="ghost" size="sm" onClick={openMove}>
              <MoveRight className="h-3.5 w-3.5" />
              Move
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              <X className="h-3.5 w-3.5" />
              Deselect
            </Button>
          </Card>
        )}

        {/* File content */}
        <Card className="overflow-hidden">
          {loadingFiles && !data && <SkeletonList view={view} />}
          {!loadingFiles && ordered.length === 0 && (
            <EmptyState
              searching={Boolean(searchQuery)}
              query={searchQuery}
              atRoot={folderId === null}
              onClear={() => setQuery("")}
              onUpload={() => document.getElementById("drive-upload-input")?.click()}
            />
          )}

          {/* List view */}
          {ordered.length > 0 && view === "list" && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80">
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        className="accent-brand-500 rounded"
                        checked={selectedCount === ordered.length && ordered.length > 0}
                        onChange={(e) => {
                          setSelected(e.target.checked ? new Set(ordered.map((i) => i.id)) : new Set());
                          lastClicked.current = null;
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </th>
                    <th className="px-3 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wide">Name</th>
                    <th className="px-3 py-3 hidden sm:table-cell text-left font-medium text-slate-500 text-xs uppercase tracking-wide">Type</th>
                    <th className="px-3 py-3 hidden md:table-cell text-left font-medium text-slate-500 text-xs uppercase tracking-wide">Size</th>
                    <th className="px-3 py-3 hidden md:table-cell text-left font-medium text-slate-500 text-xs uppercase tracking-wide">Modified</th>
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
                          <input
                            type="checkbox"
                            aria-label={`Select ${item.name}`}
                            className="accent-brand-500 opacity-0 group-hover:opacity-100 transition-opacity"
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
                              onClick={(e) => { e.stopPropagation(); openItem(item); }}
                              className="truncate font-medium text-slate-800 hover:text-brand-600 hover:underline text-left"
                              title={item.name}
                            >
                              {item.name}
                            </button>
                            {isSearching && (item as DriveFile & { path?: string | null }).path && (
                              <span className="text-xs text-slate-400 truncate shrink-0">· {(item as DriveFile & { path?: string | null }).path}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 hidden sm:table-cell text-slate-500 text-xs">{isFolder ? "Folder" : typeLabel(item.mimeType)}</td>
                        <td className="px-3 py-2.5 hidden md:table-cell text-slate-500 text-xs tabular-nums">{isFolder ? "—" : formatSize(item.size)}</td>
                        <td className="px-3 py-2.5 hidden md:table-cell text-slate-500 text-xs tabular-nums">{formatDate(item.modifiedTime)}</td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <span className="inline-flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => { e.stopPropagation(); setRenaming(item); setRenameValue(item.name); }}
                              className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
                              title="Rename"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); void openShare(item); }}
                              className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
                              title="Share"
                            >
                              <LinkIcon className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); void deleteOne(item.id); }}
                              className="rounded-lg p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
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
                // Folder cover image
                const coverUrl = isFolder ? getFolderCoverUrl(item.id) : null;
                return (
                  <div
                    key={item.id}
                    onClick={(e) => handleRowClick(e, item, i)}
                    onContextMenu={(e) => handleContextMenu(e, item)}
                    className={`group relative flex flex-col items-center rounded-2xl border p-3 cursor-pointer select-none transition-all duration-150 ${
                      isSel
                        ? "border-brand-300 ring-2 ring-brand-200 bg-brand-50 shadow-sm"
                        : "border-slate-200 hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm"
                    }`}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.name}`}
                      className="accent-brand-500 absolute top-2.5 left-2.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                      style={isSel ? { opacity: 1 } : {}}
                      checked={isSel}
                      onChange={() => toggleSelect(item.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openItem(item); }}
                      className="h-16 w-16 flex items-center justify-center mb-2 focus:outline-none overflow-hidden"
                      title={item.name}
                    >
                      {!isFolder && item.thumbnailLink && item.mimeType.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.thumbnailLink}
                          alt=""
                          className="h-full w-full object-cover rounded-xl shadow-sm"
                          loading="lazy"
                        />
                      ) : isFolder && coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={coverUrl}
                          alt=""
                          className="h-full w-full object-cover rounded-xl shadow-sm"
                          loading="lazy"
                        />
                      ) : (
                        <FileIconLarge mime={item.mimeType} isFolder={isFolder} />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openItem(item); }}
                      className="text-xs font-medium truncate w-full text-center text-slate-800 hover:text-brand-600 hover:underline leading-tight"
                      title={item.name}
                    >
                      {item.name}
                    </button>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {isFolder ? "Folder" : formatSize(item.size)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Hidden upload input */}
      <input id="drive-upload-input" type="file" multiple className="hidden" onChange={onFileInput} />

      {/* Rename modal */}
      <Modal open={Boolean(renaming)} onClose={() => setRenaming(null)} className="max-w-sm">
        <Card className="p-5">
          <h2 className="font-semibold text-slate-900 mb-4">Rename</h2>
          <input
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 mb-4"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submitRename(); }}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => void submitRename()}>Save</Button>
          </div>
        </Card>
      </Modal>

      {/* Share dialog */}
      <Modal open={Boolean(shareItem)} onClose={() => setShareItem(null)} className="max-w-md">
        <Card className="p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="font-semibold text-slate-900">Share file</h2>
              <p className="text-sm text-slate-500 truncate max-w-[18rem] mt-0.5">{shareItem?.name}</p>
            </div>
            <button onClick={() => setShareItem(null)} className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all">
              <X className="h-4 w-4" />
            </button>
          </div>

          {!shareStatus ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
              <Spinner className="h-4 w-4" />
              Checking link sharing…
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-slate-200 p-4 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium text-slate-800">Anyone with the link</div>
                  <Badge color={shareStatus.public ? "green" : "slate"} dot>
                    {shareStatus.public ? "Public" : "Restricted"}
                  </Badge>
                </div>
                {!shareStatus.public ? (
                  <Button variant="primary" size="sm" onClick={() => void makePublic()} loading={shareBusy}>
                    <LinkIcon className="h-3.5 w-3.5" />
                    Enable link sharing
                  </Button>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-slate-500">
                      Role: <span className="font-medium text-slate-700">{shareStatus.role === "reader" ? "Viewer" : shareStatus.role ?? "Viewer"}</span>
                    </div>
                    <Button variant="primary" size="sm" onClick={() => void copyShareLink()} disabled={!shareStatus.webViewLink}>
                      {shareCopied ? (
                        <><Check className="h-3.5 w-3.5" /> Copied</>
                      ) : (
                        <><LinkIcon className="h-3.5 w-3.5" /> Copy link</>
                      )}
                    </Button>
                  </div>
                )}
              </div>
              {shareStatus.public && shareStatus.webViewLink && (
                <p className="text-xs text-slate-400 break-all mb-4 font-mono bg-slate-50 rounded-lg p-2">{shareStatus.webViewLink}</p>
              )}
              <div className="flex justify-end">
                <Button variant="ghost" onClick={() => setShareItem(null)}>Close</Button>
              </div>
            </>
          )}
        </Card>
      </Modal>

      {/* Move dialog */}
      <Modal open={moveOpen} onClose={() => setMoveOpen(false)} className="max-w-md">
        <Card className="p-5">
          <h2 className="font-semibold text-slate-900 mb-1">Move to folder</h2>
          <p className="text-sm text-slate-500 mb-4">
            Moving {moveTargets.length} item{moveTargets.length > 1 ? "s" : ""} — select a destination
          </p>
          <nav className="flex items-center gap-1 text-sm mb-3 flex-wrap" aria-label="Move destination">
            <button
              onClick={() => { setMoveFolderId(null); setMoveCrumbs([]); }}
              className={`flex items-center gap-1 hover:text-brand-600 ${moveFolderId === null ? "font-semibold text-slate-900" : "text-slate-500"}`}
            >
              <House className="h-3.5 w-3.5" />
              Home
            </button>
            {moveCrumbs.map((c) => (
              <span key={c.id} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                <button
                  onClick={() => setMoveFolderId(c.id)}
                  className={`hover:text-brand-600 ${moveFolderId === c.id ? "font-semibold text-slate-900" : "text-slate-500"}`}
                >
                  {c.name}
                </button>
              </span>
            ))}
          </nav>
          <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200">
            {moveFolders.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-slate-400">
                <FolderOpen className="h-8 w-8" />
                <span className="text-sm">No subfolders here</span>
              </div>
            )}
            {moveFolders.map((f) => (
              <button
                key={f.id}
                onClick={() => setMoveFolderId(f.id)}
                className={`w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-3 text-sm border-b border-slate-50 last:border-0 transition-colors ${
                  moveFolderId === f.id ? "bg-brand-50 text-brand-700" : "text-slate-700"
                }`}
              >
                <Folder className="h-4 w-4 text-slate-400 shrink-0" />
                <span className="truncate">{f.name}</span>
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={() => setMoveOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void confirmMove()} loading={moveBusy}>
              Move here
            </Button>
          </div>
        </Card>
      </Modal>

      {/* Properties panel */}
      {propsItem && data && (
        <PropertiesPanel
          item={propsItem}
          breadcrumb={data.breadcrumb}
          workspace={workspace}
          folderId={folderId}
          onClose={() => setPropsItem(null)}
        />
      )}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenuItems}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Close sort menu on outside click */}
      {showSortMenu && (
        <div className="fixed inset-0 z-20" onClick={() => setShowSortMenu(false)} />
      )}

      {/* Undo toast for "Move to Trash" */}
      <Toast
        visible={toast.visible}
        message={toast.restoring ? "Restoring…" : toast.message}
        action={toast.restoring ? undefined : { label: "UNDO", onClick: undoTrash }}
        onDismiss={() => { if (!toast.restoring) setToast((t) => ({ ...t, visible: false })); }}
      />
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

function SkeletonList({ view }: { view: ViewMode }) {
  if (view === "grid") {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 p-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center p-3 rounded-2xl border border-slate-100 gap-2">
            <Skeleton className="h-16 w-16 rounded-xl" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-2 w-1/2" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="p-4 space-y-1">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-4 rounded" />
          <div className="h-4 flex-1 rounded animate-pulse bg-slate-100" />
          <Skeleton className="h-3 w-16 rounded hidden sm:block" />
          <Skeleton className="h-3 w-12 rounded hidden md:block" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ searching, query, atRoot, onClear, onUpload }: { searching: boolean; query: string; atRoot: boolean; onClear: () => void; onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      {searching ? (
        <>
          <div className="rounded-2xl bg-slate-100 p-5 mb-4">
            <Search className="h-8 w-8 text-slate-400" />
          </div>
          <p className="font-semibold text-slate-700">No results for &quot;{query}&quot;</p>
          <p className="text-sm text-slate-400 mt-1 mb-4">Try a different name or check the spelling.</p>
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X className="h-4 w-4" /> Clear search
          </Button>
        </>
      ) : atRoot ? (
        <>
          <div className="rounded-2xl bg-slate-100 p-5 mb-4">
            <Upload className="h-8 w-8 text-slate-400" />
          </div>
          <p className="font-semibold text-slate-700">No files yet</p>
          <p className="text-sm text-slate-400 mt-1 mb-4">Upload files or create a folder to get started.</p>
          <button
            onClick={onUpload}
            className="inline-flex items-center gap-1.5 bg-brand-500 text-white hover:bg-brand-600 rounded-xl px-4 py-2 text-sm font-medium transition-all shadow-sm"
          >
            <Upload className="h-4 w-4" /> Upload files
          </button>
        </>
      ) : (
        <>
          <div className="rounded-2xl bg-slate-100 p-5 mb-4">
            <FolderOpen className="h-8 w-8 text-slate-400" />
          </div>
          <p className="font-semibold text-slate-700">This folder is empty</p>
          <p className="text-sm text-slate-400 mt-1 mb-4">Upload files or create a subfolder.</p>
          <button
            onClick={onUpload}
            className="inline-flex items-center gap-1.5 text-slate-700 hover:bg-slate-100 rounded-xl px-4 py-2 text-sm font-medium transition-all border border-slate-200"
          >
            <Upload className="h-4 w-4" /> Upload files
          </button>
        </>
      )}
    </div>
  );
}

// ── File system entry helpers for drag & drop ────────────────────────────────

interface PagaskaFsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  createReader(): { readEntries(cb: (entries: PagaskaFsEntry[]) => void): void };
  file(cb: (f: File) => void): void;
}

function collectEntries(entries: PagaskaFsEntry[], out: File[]): Promise<void> {
  return Promise.all(
    entries.map(
      (entry) =>
        new Promise<void>((resolve) => {
          if (entry.isFile) {
            entry.file((f) => {
              try {
                Object.defineProperty(f, "webkitRelativePath", { value: entry.fullPath.replace(/^\//, "") });
              } catch { /* readonly on some engines */ }
              out.push(f);
              resolve();
            });
          } else if (entry.isDirectory) {
            const reader = entry.createReader();
            const all: PagaskaFsEntry[] = [];
            const read = () => {
              reader.readEntries((batch) => {
                if (batch.length === 0) {
                  collectEntries(all, out).then(resolve);
                } else {
                  all.push(...batch);
                  read();
                }
              });
            };
            read();
          } else {
            resolve();
          }
        })
    )
  ).then(() => undefined);
}
