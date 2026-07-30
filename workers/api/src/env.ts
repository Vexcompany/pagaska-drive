/**
 * Cloudflare Worker bindings + secrets.
 *
 * Secrets are set with `wrangler secret put NAME` and arrive via the
 * `env` argument to the fetch handler.
 */
export interface Env {
  /** Google OAuth. */
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
  /** Root Drive folder for all Pagaska profiles. */
  GOOGLE_DRIVE_ROOT: string;
  /** JWT signing secret. */
  JWT_SECRET: string;
  /** Public CORS origin (set in wrangler.toml [vars]). */
  CORS_ORIGIN?: string;
}
