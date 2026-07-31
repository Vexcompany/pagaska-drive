"use client";

import { Loader2, XCircle } from "lucide-react";
import type { ReactNode, ButtonHTMLAttributes, HTMLAttributes } from "react";

// ── Button ──────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  loading?: boolean;
}

export function Button({
  variant = "ghost",
  size = "md",
  loading,
  children,
  disabled,
  className = "",
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-all duration-150 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed";

  const sizes = {
    sm: "px-2.5 py-1.5 text-xs",
    md: "px-3 py-2 text-sm",
  };

  const variants: Record<ButtonVariant, string> = {
    primary: "bg-brand-500 text-white hover:bg-brand-600 shadow-sm",
    ghost: "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
    danger: "text-red-600 hover:bg-red-50 hover:text-red-700",
  };

  return (
    <button
      disabled={disabled || loading}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

// ── Badge ───────────────────────────────────────────────────────────────────

type BadgeColor = "green" | "amber" | "red" | "blue" | "slate";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  color?: BadgeColor;
  dot?: boolean;
}

const badgeColors: Record<BadgeColor, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  red:   "bg-red-50 text-red-700 ring-red-200",
  blue:  "bg-brand-50 text-brand-700 ring-brand-200",
  slate: "bg-slate-100 text-slate-600 ring-slate-200",
};

const dotColors: Record<BadgeColor, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red:   "bg-red-500",
  blue:  "bg-brand-500",
  slate: "bg-slate-400",
};

export function Badge({ color = "slate", dot, children, className = "", ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${badgeColors[color]} ${className}`}
      {...props}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColors[color]}`} />}
      {children}
    </span>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────

export function Card({ children, className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

// ── Spinner ─────────────────────────────────────────────────────────────────

export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 className={`animate-spin text-brand-500 ${className}`} />;
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-100 ${className}`} />;
}

// ── StatusBadge ──────────────────────────────────────────────────────────────

export function StatusBadge({ state }: { state: string }) {
  const map: Record<string, { color: BadgeColor; label: string }> = {
    queued:    { color: "slate", label: "Queued" },
    uploading: { color: "blue",  label: "Uploading" },
    paused:    { color: "amber", label: "Paused" },
    retrying:  { color: "amber", label: "Retrying" },
    failed:    { color: "red",   label: "Failed" },
    completed: { color: "green", label: "Done" },
  };
  const cfg = map[state] ?? { color: "slate" as BadgeColor, label: state };
  return (
    <Badge color={cfg.color} dot>
      {cfg.label}
    </Badge>
  );
}

// ── Modal ───────────────────────────────────────────────────────────────────

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export function Modal({ open, onClose, children, className = "" }: ModalProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-[2px] animate-fade-in"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className={`animate-pop-in w-full ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// ── ProgressBar ──────────────────────────────────────────────────────────────

export function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-slate-100 ${className}`}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Divider ──────────────────────────────────────────────────────────────────

export function Divider({ className = "" }: { className?: string }) {
  return <div className={`h-px bg-slate-100 ${className}`} />;
}

// ── ErrorBanner ───────────────────────────────────────────────────────────────

// ── Toast ────────────────────────────────────────────────────────────────────

interface ToastProps {
  message: string;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
  visible: boolean;
}

export function Toast({ message, action, onDismiss, visible }: ToastProps) {
  if (!visible) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-pop-in">
      <div className="flex items-center gap-3 rounded-xl bg-slate-900 text-white px-4 py-3 shadow-lg text-sm">
        <span>{message}</span>
        {action && (
          <button
            onClick={action.onClick}
            className="font-semibold text-brand-400 hover:text-brand-300 transition-colors whitespace-nowrap"
          >
            {action.label}
          </button>
        )}
        {onDismiss && (
          <button onClick={onDismiss} className="text-slate-400 hover:text-slate-200 ml-1">
            <XCircle className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── ContextMenu ─────────────────────────────────────────────────────────────

interface ContextMenuProps {
  x: number;
  y: number;
  items: { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        className="fixed z-50 min-w-[180px] rounded-xl border border-slate-200 bg-white shadow-xl py-1 animate-pop-in"
        style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 300) }}
      >
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => { item.onClick(); onClose(); }}
            disabled={item.disabled}
            className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
              item.disabled
                ? "text-slate-300 cursor-not-allowed"
                : item.danger
                  ? "text-red-600 hover:bg-red-50"
                  : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}

// ── ErrorBanner ──────────────────────────────────────────────────────────────

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mb-4">
      <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="text-red-500 hover:text-red-700">
          <XCircle className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
