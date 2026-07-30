import { describe, it, expect } from "vitest";
import { nextChunkRange, totalChunks, chunkIndexAt } from "../core/ChunkManager";
import type { QueuedFile } from "../types";

function mkFile(bytesUploaded: number, size: number): QueuedFile {
  return {
    id: "x",
    source: {
      file: new Blob([new Uint8Array(size)]),
      relativePath: "x.bin",
      name: "x.bin",
      size,
      mimeType: "application/octet-stream",
    },
    state: "uploading",
    pool: "normal",
    attempt: 0,
    bytesUploaded,
    errorMessage: null,
    driveFileId: null,
    startedAt: 0,
    completedAt: null,
    session: null,
    lastError: null,
    speedSamples: [],
  };
}

describe("ChunkManager", () => {
  it("returns null when the file is fully uploaded", () => {
    expect(nextChunkRange(mkFile(100, 100), 16)).toBeNull();
  });

  it("clamps the last chunk to the file size", () => {
    const f = mkFile(28, 30);
    const r = nextChunkRange(f, 16);
    expect(r).toEqual({ start: 28, end: 30 });
  });

  it("computes total chunks and chunk index", () => {
    expect(totalChunks(0, 16)).toBe(0);
    expect(totalChunks(1, 16)).toBe(1);
    expect(totalChunks(32, 16)).toBe(2);
    expect(totalChunks(33, 16)).toBe(3);
    expect(chunkIndexAt(17, 16)).toBe(1);
  });
});
