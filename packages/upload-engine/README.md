# Pagaska Drive — Upload Engine

A production-grade, resumable, chunked upload engine for Google Drive.

## Features

- **Google Drive Resumable Upload API** — never uploads a full file in a single request.
- **Chunked uploads** with configurable chunk size (8 MB, 16 MB, 32 MB, 64 MB, …).
- **Concurrent upload scheduler** with a separate, independent retry pool.
- **Exponential backoff** retry policy that only retries recoverable errors.
- **Resume from last acknowledged chunk** after browser refresh, network drop, or crash.
- **Folder upload** with recursive traversal and preserved directory structure.
- **Granular per-file state** — Queued, Preparing, Uploading, Paused, Retrying, Completed, Failed, Canceled.
- **Streaming** — files are never loaded fully into memory; chunks are streamed.
- **Mobile compatible** — handles flaky networks and partial transfers gracefully.
- **UI-agnostic** — UI consumes events; no upload logic in the UI.

## Architecture

```
src/
├── core/
│   ├── UploadEngine.ts          # Public façade
│   ├── UploadScheduler.ts       # Concurrent normal + retry pools
│   ├── ChunkManager.ts          # Slicing, hashing, streaming chunks
│   ├── RetryManager.ts          # Exponential backoff, recoverable errors
│   ├── SessionManager.ts        # Persists Google Drive resumable sessions
│   ├── QueueManager.ts          # File queue + per-file state machine
│   └── ProgressManager.ts       # Aggregate progress + ETA
├── adapters/
│   └── GoogleDriveAdapter.ts    # Resumable session protocol
├── utils/
│   ├── backoff.ts
│   ├── errors.ts
│   ├── fileTree.ts
│   ├── stream.ts
│   └── platform.ts
├── config/
│   └── defaultConfig.ts
├── types/
│   └── index.ts
└── index.ts
```

## Configuration

All knobs live in `src/config/defaultConfig.ts` and can be overridden via the
`UploadEngine` constructor.

| Key | Default | Description |
| --- | --- | --- |
| `chunkSize` | `8 * 1024 * 1024` | Chunk size in bytes |
| `normalConcurrency` | `4` | Concurrent normal uploads |
| `retryConcurrency` | `1` | Concurrent retries (independent pool) |
| `maxRetries` | `5` | Max retry attempts per file |
| `backoffSeconds` | `[3, 8, 20, 45, 90]` | Delay per retry attempt |
| `requestTimeoutMs` | `60_000` | Per-chunk HTTP timeout |
| `sessionPersistKey` | `"pagaska.upload.sessions"` | `localStorage` key |

## Usage

```ts
import { UploadEngine, defaultConfig } from "pagaska-drive-upload-engine";

const engine = new UploadEngine({
  ...defaultConfig,
  chunkSize: 16 * 1024 * 1024,
  normalConcurrency: 4,
  retryConcurrency: 1,
  getAccessToken: async () => myOAuthToken(),
  onProgress: (snapshot) => renderUI(snapshot),
  onFileStateChange: (file) => updateRow(file),
});

await engine.addFiles(fileListFromInput); // File[] from <input webkitdirectory>
engine.start();
```

## Build

```bash
npm install
npm run build
```
