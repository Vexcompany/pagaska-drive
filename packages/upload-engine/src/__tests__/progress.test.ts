import { describe, it, expect } from "vitest";
import { ProgressManager } from "../core/ProgressManager";
import { QueueManager } from "../core/QueueManager";
import type { UploadSource } from "../types";

const src = (name: string, size: number): UploadSource => ({
  file: new Blob([new Uint8Array(size)]),
  relativePath: name,
  name,
  size,
  mimeType: "application/octet-stream",
});

describe("ProgressManager", () => {
  it("aggregates totals and counts", () => {
    const q = new QueueManager();
    const [a, b, c] = q.add([src("a", 100), src("b", 200), src("c", 50)]);
    q.setBytesUploaded(a, 100);
    q.setState(a, "completed");
    q.setState(b, "failed", { errorMessage: "x" });
    q.setState(c, "uploading");
    const p = new ProgressManager(q);
    const snap = p.snapshot();
    expect(snap.totalBytes).toBe(350);
    expect(snap.uploadedBytes).toBe(100);
    expect(snap.totalFiles).toBe(3);
    expect(snap.uploadedFiles).toBe(1);
    expect(snap.failedFiles).toBe(1);
    expect(snap.queuedFiles).toBe(0);
    expect(snap.fraction).toBeCloseTo(100 / 350);
  });
});
