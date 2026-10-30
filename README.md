# workout-app

One personal fitness app to replace the stack of $10/month single-purpose apps (running, lifting, etc.).

**Status:** hello-world scaffold; feature work not started. See [docs/VISION.md](docs/VISION.md) and [docs/SPEC.md](docs/SPEC.md).

## Principles

- **All-in-one.** Running, lifting, and other training live in one place with one data model.
- **No bloat.** No social feeds, follower counts, badges-for-engagement, or ads.
- **No subscription treadmill.** Built for personal use first.
- **Own your data.** Easy export; no lock-in.

## Development

Requires pnpm ([install](https://pnpm.io/installation)); it switches itself to the version pinned in `packageManager` (12.16.1). You don't need a system Node: `pnpm install` downloads the pinned Node 24 LTS (`devEngines.runtime` in `package.json`) into the project, and every `pnpm` script runs with it. `.nvmrc` is kept for editors and tools run outside pnpm.

```sh
pnpm install
pnpm dev              # web on http://localhost:5173, API on http://127.0.0.1:3000
```

`pnpm dev` runs the Vite dev server (`apps/web`) and the Hono server (`apps/server`) together; Vite proxies `/api` and `/healthz` to the server.

Production-style run (one process serves the API and the built PWA):

```sh
pnpm build
pnpm start            # http://127.0.0.1:3000
```

Other commands: `pnpm typecheck`.

Server env vars: `HOST` (default `127.0.0.1`), `PORT` (default `3000`), `WEB_DIST` (default `../web/dist`, relative to `apps/server`).

## Layout

- `apps/web`: React + TypeScript + Vite client.
- `apps/server`: Node + Hono server (API, `/healthz`, serves the built client).
- `packages/*`: shared libraries (engine, shared types, exercise data), added as they're needed.
