import { readChunk } from "../utils/stream";
import type { QueuedFile } from "../types";

/**
 * Returns the byte range [start, end) of the next chunk to upload,
 * honoring the persisted bytes-uploaded counter (for resume) and the
 * configured chunk size.
 *
 * Returns null if there is no more work to do.
 */
export function nextChunkRange(
  file: QueuedFile,
  chunkSize: number
): { start: number; end: number } | null {
  const start = file.bytesUploaded;
  if (start >= file.source.size) return null;
  const end = Math.min(start + chunkSize, file.source.size);
  return { start, end };
}

/**
 * Reads the next chunk for a file as a Uint8Array. Streams from the
 * underlying Blob so the entire file is never materialized in memory.
 */
export async function readNextChunk(
  file: QueuedFile,
  chunkSize: number,
  signal?: AbortSignal
): Promise<{ start: number; end: number; bytes: Uint8Array } | null> {
  const range = nextChunkRange(file, chunkSize);
  if (!range) return null;
  const bytes = await readChunk(file.source.file, range.start, range.end - range.start, signal);
  return { start: range.start, end: range.end, bytes };
}

/**
 * Total number of chunks needed for a file given the chunk size.
 * The last chunk may be smaller than `chunkSize`.
 */
export function totalChunks(size: number, chunkSize: number): number {
  if (size <= 0) return 0;
  return Math.ceil(size / chunkSize);
}

/**
 * Index of the chunk that contains the byte at `offset`.
 */
export function chunkIndexAt(offset: number, chunkSize: number): number {
  return Math.floor(offset / chunkSize);
}
