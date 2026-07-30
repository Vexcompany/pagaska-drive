import { describe, it, expect } from "vitest";
import { QueueManager } from "../core/QueueManager";
import type { UploadSource } from "../types";

const src = (name: string, size = 10): UploadSource => ({
  file: new Blob([new Uint8Array(size)]),
  relativePath: name,
  name,
  size,
  mimeType: "application/octet-stream",
});

describe("QueueManager", () => {
  it("assigns ids and tracks size", () => {
    const q = new QueueManager();
    const ids = q.add([src("a.bin"), src("b.bin")]);
    expect(ids).toHaveLength(2);
    expect(q.size()).toBe(2);
  });

  it("returns queued files in insertion order", () => {
    const q = new QueueManager();
    const ids = q.add([src("a.bin"), src("b.bin"), src("c.bin")]);
    const next = q.nextQueued(2);
    expect(next.map((f) => f.id)).toEqual([ids[0], ids[1]]);
  });

  it("transitions states and emits an updated attempt counter", () => {
    const q = new QueueManager();
    const [id] = q.add([src("a.bin")]);
    q.setState(id, "uploading");
    expect(q.get(id)?.state).toBe("uploading");
    const n = q.incrementAttempt(id);
    expect(n).toBe(1);
  });

  it("only returns failed files from nextFailed", () => {
    const q = new QueueManager();
    const [a, b] = q.add([src("a.bin"), src("b.bin")]);
    q.setState(a, "failed", { errorMessage: "boom" });
    q.setState(b, "completed");
    const failed = q.nextFailed(10);
    expect(failed.map((f) => f.id)).toEqual([a]);
  });
});
