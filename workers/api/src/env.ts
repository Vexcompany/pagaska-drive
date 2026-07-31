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
  /** Root Drive folder for all Pagaska workspaces. */
  GOOGLE_DRIVE_ROOT: string;
  /** JWT signing secret. */
  JWT_SECRET: string;
  /**
   * Per-workspace passwords, validated at login. Set with
   * `wrangler secret put PAGASKA_PASSWORD`, `OSAMA_PASSWORD`, `PMR_PASSWORD`.
   * Never exposed to the frontend.
   */
  PAGASKA_PASSWORD: string;
  OSAMA_PASSWORD: string;
  PMR_PASSWORD: string;
  CORS_ORIGIN?: string;
}
