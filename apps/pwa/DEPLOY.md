# Deploying the Hermys PWA

The PWA is a static SvelteKit SPA (`adapter-static` → `dist/`). It deploys
to any static host; Vercel is wired up here.

## What can and cannot go on Vercel

- **The PWA (this package): yes.** Static files, deploys cleanly, gets a
  human-readable `*.vercel.app` URL.
- **The orchestrator: no.** It is a persistent WebSocket + SQLite server.
  Vercel is serverless and cannot host a long-lived WebSocket hub. The hub
  must run on a machine that holds open connections — the host's laptop on
  the room's WiFi today, the DGX Spark later, or a WS-capable PaaS
  (Railway / Render / Fly) for a public table.

The deployed PWA therefore needs to be pointed at a running hub:

1. **`?hub=host:port`** — a host shares a link like
   `https://<app>.vercel.app/?hub=hermys.local:8443`; it's remembered.
2. **`PUBLIC_HERMYS_HUB`** build env — bake a default hub in.
3. **Same origin** — when the orchestrator itself serves the built PWA
   (the all-in-one path: `apps/orchestrator` serves `apps/pwa/dist`).

On a bare `*.vercel.app` with none of these set, the join screen shows a
"Connect to your table" prompt instead of failing silently.

## Deploy

```bash
cd apps/pwa
vercel --prod          # first run links/creates the project
```

`vercel.json` sets the build (`npm run build`), output (`dist/`), SPA
rewrites, and immutable caching for fingerprinted assets.
