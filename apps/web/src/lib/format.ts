/**
 * Shared formatting utilities used across the app.
 * Extracted to avoid duplicating formatSize/formatDate in every page.
 */ 

export function formatSize(bytes: string | number | null | undefined): string {
  if (bytes == null || !Number.isFinite(typeof bytes === "string" ? Number(bytes) : bytes)) return "—";
  const n = typeof bytes === "string" ? Number(bytes) : bytes;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function typeLabel(mime: string): string {
  return mime.split("/").pop() ?? mime;
}

export function formatSpeed(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps) || bps <= 0) return "";
  return `${formatSize(bps)}/s`;
}

export function formatRemaining(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `${Math.round(seconds)}s left`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s left`;
}
