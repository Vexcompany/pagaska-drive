# Deployment Guide

This repo deploys as two independent services:

- `apps/web` → **Vercel**
- `workers/api` → **Cloudflare Workers** (via Wrangler)

Both read the same set of env vars; set them once per environment.

---

## 1. Google Cloud setup

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Google Drive API**.
3. Create an **OAuth 2.0 Client ID** (type: *Web application* or *Desktop*).
4. Use a one-off script (or Google's OAuth playground) to obtain a
   **refresh token** that has the `https://www.googleapis.com/auth/drive.file`
   scope. Store the resulting `refresh_token` — this is the long-lived
   credential the Worker uses.
5. Pick (or create) a folder in your personal Google Drive that will
   back all Pagaska profiles. Copy its Drive folder ID into
   `GOOGLE_DRIVE_ROOT`.

You should now have:

```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
GOOGLE_DRIVE_ROOT
JWT_SECRET          # generate: openssl rand -hex 64
```

---

## 2. Deploy the Worker (Cloudflare)

```bash
# from the repo root
npm install                      # also runs the `prepare` hook which
                                 # builds @pagaska/shared and
                                 # @pagaska/upload-engine to dist/
cd workers/api
npx wrangler login
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REFRESH_TOKEN
npx wrangler secret put GOOGLE_DRIVE_ROOT
npx wrangler secret put JWT_SECRET
npx wrangler deploy
```

> The `prepare` script in the root `package.json` automatically
> compiles the two internal workspace packages (`@pagaska/shared` and
> `@pagaska/upload-engine`) into `dist/` so that the Worker and the
> Next.js app can import them. This runs on every `npm install` and
> `npm ci`, including on Cloudflare's and Vercel's CI.

`wrangler.toml` already declares the worker name and the public
environment variable names; secrets are kept out of the repo via
`wrangler secret put`.

After deploy, Wrangler prints a URL like
`https://pagaska-api.<your-subdomain>.workers.dev`. Save it — the
Next.js app needs it.

---

## 3. Deploy the Web app (Vercel)

```bash
# from the repo root
vercel link
vercel env add NEXT_PUBLIC_API_URL          # the worker URL from step 2
vercel env add JWT_SECRET                   # same value as the worker
vercel --prod
```

The web app uses `NEXT_PUBLIC_API_URL` to talk to the worker. The
`JWT_SECRET` is used to verify session cookies on the Next.js side if
you opt into edge middleware; the source-of-truth sessions live on the
Worker.

Vercel's install command runs `npm install` at the repo root, which
also runs the `prepare` hook that builds the workspace packages. No
extra configuration is required.

---

## 4. Local dev

```bash
# from the repo root
npm install                              # also runs the prepare hook

# terminal 1 — worker
cd workers/api
npm run dev          # http://127.0.0.1:8787

# terminal 2 — web
cd apps/web
npm run dev          # http://localhost:3000
```

Set `NEXT_PUBLIC_API_URL=http://127.0.0.1:8787` in `apps/web/.env.local`
and the matching `*.dev.vars` (Wrangler format) in `workers/api/.dev.vars`:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
GOOGLE_DRIVE_ROOT=...
JWT_SECRET=...
```

---

## Troubleshooting

- **"invalid_grant" from Google** — the refresh token was revoked.
  Re-run the OAuth flow to mint a new one.
- **"storage quota exceeded"** — Google Drive has a 15 GB free-tier
  limit; the Worker surfaces this as a 507 in `/upload/finish`.
- **CORS errors in the browser** — the Worker allows `*` by default;
  tighten the `Access-Control-Allow-Origin` header in production.
