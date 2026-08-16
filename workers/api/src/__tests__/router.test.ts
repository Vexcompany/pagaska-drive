import { describe, it, expect } from "vitest";
import { signJwt, verifyJwt } from "../jwt";

const SECRET = "test-secret-do-not-use-in-prod";

/** Decode the payload segment of a JWT without verifying its signature. */
function decodePayload(token: string): Record<string, unknown> {
  const [, payloadB64] = token.split(".");
  const pad = payloadB64.length % 4 === 0 ? "" : "=".repeat(4 - (payloadB64.length % 4));
  const b64 = (payloadB64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(b64)) as Record<string, unknown>;
}

describe("jwt", () => {
  it("round-trips a token (legacy signature: payload, secret, ttl)", async () => {
    const tok = await signJwt({ sub: "pagaska", workspace: "pagaska" }, SECRET, 60);
    const decoded = await verifyJwt(tok, SECRET);
    expect(decoded?.workspace).toBe("pagaska");
    expect(decoded?.sub).toBe("pagaska");
  });

  it("rejects a tampered token", async () => {
    const tok = await signJwt({ sub: "pagaska", workspace: "pagaska" }, SECRET, 60);
    const tampered = tok.slice(0, -3) + "AAA";
    const decoded = await verifyJwt(tampered, SECRET);
    expect(decoded).toBeNull();
  });

  it("rejects an expired token", async () => {
    const tok = await signJwt({ sub: "pagaska", workspace: "pagaska" }, SECRET, -1);
    const decoded = await verifyJwt(tok, SECRET);
    expect(decoded).toBeNull();
  });

  it("mints a non-expiring token with no exp claim when ttl is omitted", async () => {
    const tok = await signJwt({ sub: "pagaska", workspace: "pagaska" }, SECRET);
    const payload = decodePayload(tok);
    expect(payload.exp).toBeUndefined();
    expect(payload.iat).toBeTypeOf("number");

    const decoded = await verifyJwt(tok, SECRET);
    expect(decoded).not.toBeNull();
    expect(decoded?.workspace).toBe("pagaska");
  });

  it("still accepts a valid legacy token that carries exp", async () => {
    const tok = await signJwt({ sub: "pagaska", workspace: "pagaska" }, SECRET, 60);
    expect(decodePayload(tok).exp).toBeTypeOf("number");

    const decoded = await verifyJwt(tok, SECRET);
    expect(decoded?.workspace).toBe("pagaska");
  });

  it("still rejects a legacy token whose exp has passed", async () => {
    const tok = await signJwt({ sub: "pagaska", workspace: "pagaska" }, SECRET, -1);
    expect(await verifyJwt(tok, SECRET)).toBeNull();
  });

  it("rejects a non-expiring token with an invalid signature", async () => {
    const tok = await signJwt({ sub: "pagaska", workspace: "pagaska" }, SECRET);
    const tampered = tok.slice(0, -3) + "AAA";
    expect(await verifyJwt(tampered, SECRET)).toBeNull();
  });
});
