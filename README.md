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

The built app is an installable PWA (manifest, service worker via vite-plugin-pwa). The service worker only runs from `pnpm build` output, not `pnpm dev`, and only on a secure origin: `localhost`/`127.0.0.1` on the laptop, HTTPS (Tailscale Serve, #23) on the phone. A new build shows an "Update available" bar instead of reloading on its own.

Other commands: `pnpm test` (`test:watch`), `pnpm typecheck`, `pnpm lint` (`lint:fix`), `pnpm format` (`format:check`). CI runs lint, format check, typecheck, tests and build on every PR (`.github/workflows/ci.yml`).

## Run with Docker Compose

The deployable form is one container (SPEC §8): Node serves the API and the built PWA. Needs Docker with Compose v2; no Node or pnpm on the host.

```sh
docker compose up -d --build   # http://127.0.0.1:3000
docker compose ps              # shows (healthy) once /healthz responds
docker compose logs -f
docker compose down            # keeps the data volume; add -v to delete it
```

- The port is published on `127.0.0.1` only, so nothing else on the network can reach it; Tailscale Serve will provide HTTPS and tailnet access (#23). Set `PORT` to use a different host port, e.g. `PORT=8080 docker compose up -d`.
- App data lives in the `data` volume, mounted at `/data` in the container (`/data/app.db` plus its `backups/`).
- The image runs as the unprivileged `node` user and has a built-in healthcheck on `/healthz`. It builds for `linux/amd64` and `linux/arm64`; CI builds and smoke-tests both on every PR, but nothing is pushed to a registry yet.

Server env vars: `HOST` (default `127.0.0.1`), `PORT` (default `3000`), `WEB_DIST` (default `../web/dist`, relative to `apps/server`), `DATABASE_PATH` (default `data/app.db`, relative to `apps/server`; `/data/app.db` in Docker).

## Database

SQLite through better-sqlite3 and Drizzle. Pending migrations in `apps/server/drizzle/` run when the server starts, and an existing database is first copied to `backups/` next to the DB file. To change the schema, edit `apps/server/src/schema.ts`, run `pnpm --filter @workout-app/server db:generate` and commit the generated SQL. Migrations are forward-only: fix a bad one with a new migration, never by editing an applied one.

## Layout

- `apps/web`: React + TypeScript + Vite client.
- `apps/server`: Node + Hono server (API, `/healthz`, serves the built client).
- `packages/*`: shared libraries (engine, shared types, exercise data), added as they're needed.
