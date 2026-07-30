import { describe, it, expect } from "vitest";
import { validateConfig } from "../config/defaultConfig";

describe("validateConfig", () => {
  it("rejects chunk sizes below the Drive minimum", () => {
    expect(() => validateConfig({ chunkSize: 1024 })).toThrow(/256 KB/);
  });

  it("rejects non-power-of-two chunk sizes", () => {
    expect(() => validateConfig({ chunkSize: 3 * 1024 * 1024 })).toThrow(/power of two/);
  });

  it("accepts a sane config", () => {
    expect(() =>
      validateConfig({ chunkSize: 16 * 1024 * 1024, normalConcurrency: 4, retryConcurrency: 1 })
    ).not.toThrow();
  });
});
