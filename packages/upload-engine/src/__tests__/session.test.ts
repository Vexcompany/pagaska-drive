import { describe, it, expect } from "vitest";
import { SessionManager } from "../core/SessionManager";
import type { SessionStorage, ResumableSession } from "../types";

const memory = (): SessionStorage => {
  let data: Record<string, ResumableSession> = {};
  return {
    read: () => ({ ...data }),
    write: (d) => {
      data = { ...d };
    },
    clear: () => {
      data = {};
    },
  };
};

describe("SessionManager", () => {
  it("round-trips sessions", () => {
    const s = new SessionManager(memory());
    const session: ResumableSession = {
      sessionUri: "https://example.com/session/abc",
      bytesUploaded: 0,
      totalBytes: 1024,
      parentId: null,
      filename: "a.bin",
      mimeType: "application/octet-stream",
      openedAt: 1,
    };
    s.set("file-1", session);
    expect(s.get("file-1")?.sessionUri).toBe(session.sessionUri);
    s.setBytesUploaded("file-1", 512);
    expect(s.get("file-1")?.bytesUploaded).toBe(512);
    s.remove("file-1");
    expect(s.get("file-1")).toBeNull();
  });
});
