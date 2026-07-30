# Pagaska Drive

A privacy-first Google Drive client. Users sign in to Pagaska (not Google),
pick a profile, and get a clean Drive-like experience with chunked,
resumable uploads.

```
.
├── apps/
│   └── web/                  # Next.js 15 (App Router) frontend
├── workers/
│   └── api/                  # Cloudflare Worker REST API
├── packages/
│   └── upload-engine/        # Resumable upload engine (used by the web app)
└── shared/                   # Cross-package TypeScript types
```

## Stack

- **Frontend** — Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS, deployed to Vercel
- **Backend** — Cloudflare Workers + TypeScript, deployed with Wrangler
- **Storage** — Google Drive (via server-side OAuth refresh token, never exposed to the client)
- **Upload engine** — internal `@pagaska/upload-engine` package, used by the web app

## Quick start

```bash
# 1. install
npm install

# 2. configure
cp .env.example .env
# fill in GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
# GOOGLE_DRIVE_ROOT, JWT_SECRET

# 3. dev
npm --workspace apps/web run dev
# in another terminal:
npm --workspace workers/api run dev

# 4. build
npm run build

# 5. test
npm test
```

## Deploy

See [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## Architecture

```
┌──────────────┐  HTTPS   ┌─────────────────┐  HTTPS   ┌─────────────┐
│  Next.js UI  │ ───────▶ │  CF Worker API  │ ───────▶ │ Google Drive│
│  (Vercel)    │           │  (Wrangler)     │           │             │
└──────────────┘           └─────────────────┘           └─────────────┘
       │                            ▲
       │  /upload/* (direct PUT)    │
       ▼                            │
┌──────────────┐  chunked PUT  ┌────┴────────────┐
│ Upload Engine│ ────────────▶ │ Drive Resumable │
│ (internal)   │               │ Session URI     │
└──────────────┘               └─────────────────┘
```

The browser only ever talks to two things:

1. **The Next.js app** — for the UI, profile selection, file listing.
2. **The Cloudflare Worker** — for a tiny REST surface (login, list,
   folder CRUD, rename, delete, preview URL, and the start/chunk/finish
   helpers used by the upload engine).

The browser **never** sees a Google OAuth token. All Google calls are
made server-side inside the Worker using a single refresh token.

## License

MIT
