import { describe, it, expect } from "vitest";
import { signJwt, verifyJwt } from "../jwt";

const SECRET = "test-secret-do-not-use-in-prod";

describe("jwt", () => {
  it("round-trips a token", async () => {
    const tok = await signJwt({ sub: "pagaska", profile: "pagaska" }, 60, SECRET);
    const decoded = await verifyJwt(tok, SECRET);
    expect(decoded?.profile).toBe("pagaska");
    expect(decoded?.sub).toBe("pagaska");
  });

  it("rejects a tampered token", async () => {
    const tok = await signJwt({ sub: "pagaska", profile: "pagaska" }, 60, SECRET);
    const tampered = tok.slice(0, -3) + "AAA";
    const decoded = await verifyJwt(tampered, SECRET);
    expect(decoded).toBeNull();
  });

  it("rejects an expired token", async () => {
    const tok = await signJwt({ sub: "pagaska", profile: "pagaska" }, -1, SECRET);
    const decoded = await verifyJwt(tok, SECRET);
    expect(decoded).toBeNull();
  });
});
