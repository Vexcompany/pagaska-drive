import type {
  ProgressSnapshot,
  QueuedFile,
  UploadEngineConfig,
  UploadFileSnapshot,
  UploadSource,
} from "../types";
import { defaultConfig, validateConfig } from "../config/defaultConfig";
import { defaultSessionStorage, nullLogger } from "../utils/platform";
import { SessionManager } from "./SessionManager";
import { QueueManager } from "./QueueManager";
import { RetryManager } from "./RetryManager";
import { ProgressManager } from "./ProgressManager";
import { UploadScheduler } from "./UploadScheduler";
import { GoogleDriveAdapter } from "../adapters/GoogleDriveAdapter";

/**
 * Public façade for the upload engine.
 *
 * The UI instantiates ONE engine and calls `addFiles`, `start`, `pause`,
 * `cancel`, `retry` etc. The engine wires the modules together and
 * exposes a `snapshot()` for the UI to render.
 */
export class UploadEngine {
  private readonly config: UploadEngineConfig;
  private readonly queue: QueueManager;
  private readonly sessions: SessionManager;
  private readonly retry: RetryManager;
  private readonly adapter: GoogleDriveAdapter;
  private readonly progress: ProgressManager;
  private readonly scheduler: UploadScheduler;
  private readonly logger: UploadEngineConfig["logger"];

  constructor(userConfig: Partial<UploadEngineConfig> & { getAccessToken: () => Promise<string> }) {
    validateConfig(userConfig);
    const storage = userConfig.storage ?? defaultSessionStorage(userConfig.sessionPersistKey ?? defaultConfig.sessionPersistKey);
    this.config = {
      ...defaultConfig,
      ...userConfig,
      storage,
    } as UploadEngineConfig;

    this.logger = this.config.logger ?? nullLogger;
    this.queue = new QueueManager();
    this.sessions = new SessionManager(this.config.storage!);
    this.retry = new RetryManager(this.config, this.logger);
    this.adapter = new GoogleDriveAdapter(this.config, this.logger);
    this.progress = new ProgressManager(this.queue, (snap) => {
      this.config.onProgress?.(snap);
    });
    this.scheduler = new UploadScheduler(
      this.config,
      this.queue,
      this.sessions,
      this.retry,
      this.adapter,
      this.progress,
      this.logger,
      {
        onFileStateChange: (id) => {
          const snap = this.queue.snapshot(id);
          if (snap) this.config.onFileStateChange?.(snap);
        },
      }
    );
  }

  /**
   * Replace the underlying Google Drive adapter with a caller-supplied
   * one. Intended for integrations where the resumable session is
   * proxied through a backend (e.g. Pagaska Drive) — the engine's
   * scheduler will use the supplied adapter for `openSession`,
   * `uploadChunk`, and `queryProgress`.
   *
   * Must be called BEFORE `start()`. The replacement is one-shot;
   * subsequent calls throw.
   */
  setAdapter(adapter: GoogleDriveAdapter): void {
    if (!this.scheduler) {
      throw new Error("setAdapter: engine not initialized");
    }
    this.scheduler.setAdapter(adapter);
  }

  // -------------------------------------------------------------------------
  // File ingestion
  // -------------------------------------------------------------------------
  addFiles(sources: UploadSource[]): string[] {
    const ids = this.queue.add(sources);
    // Replay persisted sessions if the ids match (callers can pair by
    // relative path + size to re-bind).
    for (const id of ids) {
      const f = this.queue.get(id);
      if (!f) continue;
      const persisted = this.sessions.get(id);
      if (persisted) {
        this.queue.setSession(id, persisted);
        this.queue.setBytesUploaded(id, persisted.bytesUploaded);
      }
    }
    this.progress.tick();
    return ids;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------
  start(): void {
    this.scheduler.start();
  }

  pauseAll(): void {
    this.scheduler.setPaused(true);
  }

  resumeAll(): void {
    this.scheduler.setPaused(false);
  }

  async stop(): Promise<void> {
    await this.scheduler.join();
  }

  // -------------------------------------------------------------------------
  // Per-file controls
  // -------------------------------------------------------------------------
  pauseFile(id: string): void {
    const f = this.queue.get(id);
    if (!f) return;
    if (f.state === "completed" || f.state === "canceled") return;
    this.queue.setState(id, "paused");
    this.queue.setPool(id, null);
  }

  resumeFile(id: string): void {
    const f = this.queue.get(id);
    if (!f) return;
    if (f.state !== "paused" && f.state !== "failed") return;
    this.queue.setState(id, "queued");
    this.queue.setError(id, null, null);
    this.queue.setPool(id, null);
  }

  cancelFile(id: string): void {
    const f = this.queue.get(id);
    if (!f) return;
    this.queue.setState(id, "canceled");
    this.queue.setPool(id, null);
    this.sessions.remove(id);
  }

  retryFile(id: string): void {
    const f = this.queue.get(id);
    if (!f) return;
    if (f.state !== "failed") return;
    this.queue.setState(id, "queued", { errorMessage: null });
    this.queue.setPool(id, null);
    this.queue.setError(id, null, null);
  }

  /** Retry every file currently in the `failed` state. */
  retryAllFailed(): number {
    const n = this.queue.resetFailedToQueued();
    this.progress.tick();
    return n;
  }

  cancelAll(): void {
    for (const f of this.queue.all()) {
      if (f.state !== "completed" && f.state !== "canceled") {
        this.queue.setState(f.id, "canceled");
        this.queue.setPool(f.id, null);
        this.sessions.remove(f.id);
      }
    }
  }

  pauseAllFiles(): void {
    for (const f of this.queue.all()) {
      if (f.state === "queued" || f.state === "uploading" || f.state === "retrying") {
        this.queue.setState(f.id, "paused");
        this.queue.setPool(f.id, null);
      }
    }
    this.scheduler.setPaused(true);
  }

  // -------------------------------------------------------------------------
  // Read-only views
  // -------------------------------------------------------------------------
  snapshot(): ProgressSnapshot {
    return this.progress.snapshot();
  }

  fileSnapshot(id: string): UploadFileSnapshot | null {
    return this.queue.snapshot(id);
  }

  allFiles(): QueuedFile[] {
    return this.queue.all();
  }

  /** Wipe finished entries from memory. */
  prune(): number {
    return this.queue.pruneFinished();
  }
}
