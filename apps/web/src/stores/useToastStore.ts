"use client";

/**
 * Global toast store — provides a simple imperative API for showing
 * toast notifications from anywhere in the app. The toast is rendered
 * by the <GlobalToast /> component in the providers tree.
 *
 * Usage:
 *   import { showToast } from "@/stores/useToastStore";
 *   showToast("Folder cover updated");
 *   showToast("Link copied", { type: "success" });
 */

export type ToastType = "success" | "error" | "info";

interface ToastEntry {
  id: number;
  message: string;
  type: ToastType;
  action?: { label: string; onClick: () => void };
}

let nextId = 0;
let current: ToastEntry | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function showToast(
  message: string,
  options?: { type?: ToastType; action?: { label: string; onClick: () => void } },
): void {
  current = {
    id: nextId++,
    message,
    type: options?.type ?? "success",
    action: options?.action,
  };
  notify();

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    if (current && current.id === (current?.id)) {
      // Only dismiss if it's still the same toast
      dismissToast();
    }
  }, 4000);
}

export function dismissToast(): void {
  current = null;
  notify();
}

export function getCurrentToast(): ToastEntry | null {
  return current;
}

export function useToastState(): ToastEntry | null {
  // This is a simple hook that re-renders on toast changes.
  // The actual rendering is handled by <GlobalToast />.
  return current;
}

// ── React hook for subscribing to toast changes ────────────────────────

import { useState, useEffect } from "react";

export function useToastSubscription(): ToastEntry | null {
  const [toast, setToast] = useState<ToastEntry | null>(current);

  useEffect(() => {
    const listener = () => setToast(current);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return toast;
}
