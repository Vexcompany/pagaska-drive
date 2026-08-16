/**
 * Minimal HS256 JWT implementation. We avoid pulling in `jose` to keep
 * the Worker bundle small and avoid extra dependencies.
 *
 * The token format is the standard three-base64url-segments layout
 * (header.payload.signature) — verified with Web Crypto.
 */

import type { Workspace } from "@pagaska/shared";

export interface JwtPayload {
  sub: string; // workspace id
  workspace: Workspace;
  iat: number;
  /** Expiry, seconds since epoch. Absent on non-expiring tokens issued
   *  after the "stay signed in" change. When present it is still
   *  validated so older (legacy) tokens remain compatible. */
  exp?: number;
}

const encoder = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signJwt(
  payload: Omit<JwtPayload, "iat" | "exp">,
  secret: string,
  ttlSeconds?: number
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: JwtPayload = { ...payload, iat: now };
  // `ttlSeconds` is optional: omit it to mint a non-expiring session
  // (no `exp` claim). A finite value — including a negative one, which
  // callers/tests use to simulate an already-expired token — still
  // produces an `exp` claim.
  if (typeof ttlSeconds === "number" && Number.isFinite(ttlSeconds)) {
    full.exp = now + ttlSeconds;
  }
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = b64urlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = b64urlEncode(encoder.encode(JSON.stringify(full)));
  const data = encoder.encode(`${headerB64}.${payloadB64}`);
  const key = await importKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  return `${headerB64}.${payloadB64}.${b64urlEncode(sig)}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const key = await importKey(secret);
  const data = encoder.encode(`${headerB64}.${payloadB64}`);
  const expected = b64urlDecode(sigB64);
  const ok = await crypto.subtle.verify("HMAC", key, expected, data);
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) as JwtPayload;
    // Validate expiry only when an `exp` claim is present (legacy tokens).
    // Tokens minted without `exp` are treated as non-expiring.
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

