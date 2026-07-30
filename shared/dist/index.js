/**
 * Shared types between the Next.js app, the Cloudflare Worker, and the
 * upload engine. Anything in here MUST be safe to import in all three
 * runtimes (browser, edge worker, node tests).
 */
export const PROFILES = ["pagaska", "osama"];
export function isProfile(value) {
    return typeof value === "string" && PROFILES.includes(value);
}
//# sourceMappingURL=index.js.map