"use client";

/**
 * Upload panel hook — manages the floating upload panel state.
 * The panel persists across page navigation so uploads continue
 * while the user browses. The state is stored in a module-level
 * singleton so it survives React re-renders and route changes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createEngine, toUploadSources } from "@/lib/engine";
import type { ProgressSnapshot, UploadFileSnapshot, UploadEngine } from "@pagaska/upload-engine";

// ── Module level singleton ──────────────────────────────────────────────

interface UploadPanelState {
  engine: UploadEngine | null;
  snapshot: ProgressSnapshot | null;
  files: UploadFileSnapshot[];
  folderId: string | null;
  visible: boolean;
  minimized: boolean;
}

const singleton: UploadPanelState = {
  engine: null,
  snapshot: null,
  files: [],
  folderId: null,
  visible: false,
  minimized: false,
};

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

function getEngine(folderId: string | null): UploadEngine {
  if (singleton.engine && singleton.folderId === folderId) {
    return singleton.engine;
  }
  // Clean up old engine
  if (singleton.engine) {
    void singleton.engine.stop();
  }

  const engine = createEngine({
    parentId: folderId,
    onProgress: (snap) => {
      singleton.snapshot = snap;
      notify();
    },
    onFileStateChange: (file) => {
      const idx = singleton.files.findIndex((f) => f.id === file.id);
      if (idx === -1) {
        singleton.files = [...singleton.files, file];
      } else {
        const next = singleton.files.slice();
        next[idx] = file;
        singleton.files = next;
      }
      notify();
    },
  });

  singleton.engine = engine;
  singleton.folderId = folderId;
  return engine;
}

// ── Public actions ──────────────────────────────────────────────────────

export function addFilesToPanel(rawFiles: File[], folderId: string | null): void {
  const engine = getEngine(folderId);
  const sources = toUploadSources(rawFiles);
  engine.addFiles(sources);
  engine.start();
  singleton.visible = true;
  singleton.minimized = false;
  notify();
}

export function pauseAllUploads(): void {
  singleton.engine?.pauseAll();
}

export function resumeAllUploads(): void {
  singleton.engine?.resumeAll();
}

export function retryAllFailedUploads(): void {
  singleton.engine?.retryAllFailed();
}

export function cancelAllUploads(): void {
  singleton.engine?.cancelAll();
  singleton.files = [];
  singleton.snapshot = null;
  singleton.visible = false;
  notify();
}

export function pauseFile(id: string): void {
  singleton.engine?.pauseFile(id);
}

export function resumeFile(id: string): void {
  singleton.engine?.resumeFile(id);
}

export function retryFile(id: string): void {
  singleton.engine?.retryFile(id);
}

export function cancelFile(id: string): void {
  singleton.engine?.cancelFile(id);
}

export function setPanelMinimized(minimized: boolean): void {
  singleton.minimized = minimized;
  notify();
}

export function closePanel(): void {
  // Only close if all uploads are done
  const isActive = singleton.files.some(
    (f) => f.state === "uploading" || f.state === "queued" || f.state === "paused" || f.state === "retrying"
  );
  if (!isActive) {
    singleton.visible = false;
    singleton.files = [];
    singleton.snapshot = null;
    notify();
  }
}

// ── Hook ────────────────────────────────────────────────────────────────

export interface UploadPanelSnapshot {
  snapshot: ProgressSnapshot | null;
  files: UploadFileSnapshot[];
  visible: boolean;
  minimized: boolean;
  isActive: boolean;
  allDone: boolean;
}

export function useUploadPanel(): UploadPanelSnapshot {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const isActive = singleton.files.some(
    (f) => f.state === "uploading" || f.state === "queued" || f.state === "paused" || f.state === "retrying"
  );

  const allDone = !isActive && singleton.files.length > 0 && singleton.files.every(
    (f) => f.state === "completed" || f.state === "failed"
  );

  return {
    snapshot: singleton.snapshot,
    files: singleton.files,
    visible: singleton.visible,
    minimized: singleton.minimized,
    isActive,
    allDone,
  };
}
