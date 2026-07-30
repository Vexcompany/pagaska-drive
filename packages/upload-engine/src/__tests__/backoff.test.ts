import { describe, it, expect } from "vitest";
import { computeBackoffMs } from "../utils/backoff";

describe("computeBackoffMs", () => {
  const table = [3, 8, 20, 45, 90];

  it("returns the first delay for attempt 1", () => {
    expect(computeBackoffMs(1, table)).toBe(3_000);
  });

  it("returns the second delay for attempt 2", () => {
    expect(computeBackoffMs(2, table)).toBe(8_000);
  });

  it("caps at the last entry if attempt exceeds the table length", () => {
    expect(computeBackoffMs(99, table)).toBe(90_000);
  });

  it("returns 0 for a non-positive attempt", () => {
    expect(computeBackoffMs(0, table)).toBe(0);
  });
});
