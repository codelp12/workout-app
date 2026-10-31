# Decisions

Newest first. Each entry gives the decision, why it was made, and the spec section it affects.

## 2026-10-31: Windows PC as the interim host (#23)

- **The owner's Windows PC hosts the app until an always-on Linux box exists**, with Docker Desktop and Tailscale for Windows (`docs/DEPLOY.md`, "Windows host"). This answers §12 Q1 for now; the MacBook was only for the iPhone check. (§8, §12 Q1)
- **Accepted cost: downtime after forced restarts.** Docker Desktop starts only after a Windows sign-in, so a Windows Update restart takes the app down until the owner signs in. No data is lost: the phone keeps logging offline, SQLite (WAL) keeps every acknowledged write, and unacknowledged ones are still in the outbox. Checked by `docker kill`-ing the container after a write: the row was there after restart. (§3.1, §8)
- **Name the Tailscale machine after the app, not the hardware** (e.g. `workout`). A move to new hardware is then a database restore plus giving the new machine the same name, so the URL, and with it the phone's installed app and local data, survives.
- **One backup one-liner for bash and PowerShell.** It builds the file name in JavaScript and avoids shell-specific quoting.

## 2026-10-31: iPhone check passed (#24)

- **The offline design works on a real iPhone.** The owner ran every step in `docs/IPHONE-CHECKLIST.md`: install from Safari over HTTPS, launch and write a note in airplane mode, relaunch, reconnect, and see the note on the laptop exactly once. All passed, so SPEC §3.3 and §3.4 hold and Phase 1 can build on the Dexie outbox and service worker. Results are on #24. (§3.3, §3.4, §9)
- **MacBook as the temporary Phase 0 host.** It runs the app in Docker Desktop with `tailscale serve --bg 3000`. That's fine for testing, but the phone can't sync while the Mac sleeps, so it isn't the permanent host. §12 Q1 and #23 stay open until the always-on box exists. (§8, §12 Q1)

## 2026-10-31: Core schema (#26)

- **Zod schemas in `packages/shared` are the row contract.** Server and web import the types from `@workout-app/shared`; the Drizzle tables in `apps/server/src/schema.ts` mirror them, and `schema.test.ts` fails (at compile time and at runtime) if a table's row type or columns drift from its zod schema. Hand-written, so no `drizzle-zod` dependency. (§2, §4)
- **Workspace packages resolve to TypeScript source in dev.** The `@workout-app/source` export condition (set in `tsconfig.base.json`, Vite, Vitest and `tsx watch`) points at `src/`; builds and production use `dist/`. The server imports only types from shared, so `drizzle-kit` and the built server don't load it at runtime.
- **UUIDv7 ids from `uuid`'s `v7()`**, via `newId()`, as approved on the roadmap. (§3.2)
- **Every synced table has `id`, `user_id`, `created_at`, `updated_at`, `deleted_at` and `server_seq`, with `server_seq` indexed** for pull-since queries. Timestamps are epoch milliseconds (UTC); training dates are ISO `YYYY-MM-DD` text, stored next to a timezone where a log needs one. (§3.2, §4)
- **Weights are a value and a unit.** `set_log` has `load_value` + `load_unit` columns; nested weights (exercise increment, goal loads) are `{ value, unit }` JSON. (§4)
- **No foreign keys; parent ids are indexed.** Rows arrive through sync ops in any order and deletes are tombstones, so an FK failure would wedge the outbox. Referential checks belong in the sync endpoints (#27). (§3.2)
- **Nested data is JSON text** (equipment, availability, template slots, planned-item targets, run splits, exercise media). It's always read and written with its row, and SQLite's JSON functions can still query it.
- **`op_receipt` is server-only**, keyed by op id, not a synced entity. (§3.2)
- **`spike_note` and `/api/spike` stay until the iPhone check (#24) has run.** The checklist and the offline E2E test use them; the client sync engine (#28) replaces both and drops the table.
- **`readiness_checkin`, `fitness_state` and `engine_decision` are deferred** to the epics that first write them; #26 covers the Phase 1 logging entities. (§4)

## 2026-10-31: Deploy runbook and iPhone checklist (#23, #24)

- **Tailscale runs on the host, not as a sidecar container.** `tailscale serve --bg 3000` proxies HTTPS on :443 to the existing `127.0.0.1:3000` port, so `compose.yaml` doesn't change and the tailnet node outlives app rebuilds. The server's key expiry is disabled so it doesn't fall off the tailnet after 180 days. (§3.3, §8)
- **No change needed for CSRF behind Serve.** Serve keeps the `Host` header but the app sees plain HTTP, so `Origin` (`https://…`) doesn't match the request URL. Hono's `csrf()` only checks form-type bodies and accepts a same-origin `Sec-Fetch-Site`, and the app posts JSON, so sign-in works; checked with curl using Serve's headers. (§8)
- **Manual `VACUUM INTO` backups until the nightly job exists.** `docs/DEPLOY.md` gives a one-liner that runs in the running container, plus a restore that deletes the old `-wal`/`-shm` files. Both were tested against the Compose stack. (§8)
- **The iPhone checklist lives in `docs/IPHONE-CHECKLIST.md`**, with a results template for the issue, so later phases can add their per-release items from §10.
- **Host choice is still open (§12 Q1).** It gets its own entry when the owner picks the box.

## 2026-10-31: Single-user sign-in (#29)

- **Password only, one account.** A single `account` row (id 1) holds the password hash. Passkeys (also allowed by §8) can come later; a password is enough behind Tailscale and needs no extra dependency. (§8)
- **Node's built-in `crypto.argon2` (argon2id), no new dependency.** Node 24 ships it. Parameters are OWASP's baseline (19 MiB, 2 passes, 1 lane), stored in a PHC string so they can be raised later without breaking old hashes. (§2, §8)
- **Password is set with a CLI, not a setup page.** `node dist/set-password.js` prompts (or reads stdin) and writes the hash to the database, so no secret lives in git, env files or the image, and there's no unauthenticated "first visitor sets the password" window. Setting it signs out every session. (§8)
- **Opaque session tokens, stored hashed.** The cookie holds 32 random bytes; the `auth_session` table stores only their SHA-256, so a copy of the database can't be used to sign in. Sessions last 90 days and slide forward, but the row and cookie are only rewritten once a day has passed, not on every request. Logout deletes the row. (§8)
- **Cookie is HttpOnly, Secure, SameSite=Lax.** Secure is on by default; `COOKIE_SECURE=false` exists for plain-HTTP testing (WebKit drops Secure cookies on `http://127.0.0.1`, so the E2E server sets it). Hono's `csrf()` also rejects cross-origin form posts to `/api/*`. (§8)
- **Login rate limit is in memory: 5 failures per 15 minutes, global.** One user and one process, so a per-IP or persistent limiter adds nothing; a restart clears it. Over the limit, login returns 429 with `Retry-After`, even for the right password. (§8)
- **Signed-out writes stay local.** The UI always shows the local notes; a 401 on push keeps the outbox entry, and signing in triggers a sync. Offline, the app shows "Offline" instead of the sign-in form. The "Sign in to sync" chip waits for the sync engine (#28). (§3.2, §8)
- **E2E uses a temp-file database instead of `:memory:`**, so `set-password.js` can set the test password before the server starts. (§10)

## 2026-10-31: Playwright E2E (#22)

- **`@playwright/test` `~1.64.1` in its own `e2e/` workspace package.** Playwright is named in §10. A separate package keeps it out of the Vitest projects (`apps/*`, `packages/*`) and gives it its own tsconfig, while `pnpm typecheck` and `pnpm lint` still cover it. (§10)
- **Tests run against the production build.** The Playwright `webServer` starts the built server on :4173 with `DATABASE_PATH=:memory:`, so the real service worker and precache are exercised and every run starts with an empty database. (§10)
- **Chromium and WebKit, both at 390×844.** The offline test waits for the service worker to control the page, goes offline with `context.setOffline`, reloads from the precache, writes a spike note, reloads again to check the outbox survives, then reconnects and relies on the `online` event (no "Sync now" click) to push. It checks that the server holds the note exactly once and saves offline and synced screenshots. (§10)
- **E2E runs in the existing `Lint, test and build` job**, after `build`, so the required check name doesn't change. Browsers are installed with `--with-deps` on each run (not cached yet), and `e2e/test-results/` is uploaded as the `e2e-results` artifact. Job timeout raised from 15 to 20 minutes. (§10)
- **The spike test goes when the spike does.** When the spike UI is replaced in Epic B, this test becomes the real outbox test; the Playwright setup and offline-load steps carry into the infra template. (§10)

## 2026-10-31: Offline write spike (#21)

- **Throwaway `spike_note` table and `/api/spike` routes.** They prove the offline write path end to end before the real sync protocol (#27/#28) exists. The core schema (#26) should add a migration that drops `spike_note`, and Epic B replaces the routes and `apps/web/src/spike-db.ts`. (§3.2, §4)
- **Idempotency is a unique `op_id`.** The client generates the op ID and the note ID (UUIDs). The server inserts with `ON CONFLICT DO NOTHING` and returns `duplicate: true` on a retry, so a lost response can be retried safely. This is the same shape §3.2 uses for the real outbox. (§3.2)
- **Dexie `^4.4.7` on the client, zod `^4.6.7` on the server.** Both come from §2. The note and its outbox entry are written in one Dexie transaction; the outbox is pushed oldest first, stops at the first failure, and an entry is removed only after the server acknowledges it. Pushes run on load, on `online`, when the tab becomes visible, and from a "Sync now" button. (§2, §3.2)
- **`createApp(db)` instead of a module-level app.** The server now opens and migrates the database before building routes, so tests pass an in-memory database. (§10)

## 2026-10-31: SQLite and Drizzle on the server (#20)

- **better-sqlite3 `^13.0.3` + drizzle-orm `~0.45.4` + drizzle-kit `~0.31.11`.** These come from §2. Drizzle stays on the stable 0.45 line rather than the 1.0 betas. better-sqlite3 13 bundles prebuilt binaries for linux (glibc and musl), macOS and Windows on x64 and arm64, and has no install script. So nothing is compiled, and it does **not** need an `allowBuilds` entry, despite what the issue suggested. `@types/better-sqlite3` provides its types. (§2)
- **`src/db.ts`: `openDb(path)` + `runMigrations(db)`.** The path comes from `DATABASE_PATH`: `data/app.db` relative to the server in dev, `/data/app.db` (the Compose volume) in Docker, and `:memory:` in tests. Connections use WAL, `foreign_keys = ON` and a 5 s busy timeout. Migrations are drizzle-kit SQL files in `apps/server/drizzle/`, applied in one transaction on every start; a failure rolls back and the server doesn't start. (§2, §8)
- **Pre-migration backup with `VACUUM INTO`.** This happens only when the file already has tables and at least one migration is pending. The copy goes to `<db dir>/backups/<name>-pre-migrate-<timestamp>.db` and is a consistent snapshot even in WAL mode. Old copies aren't pruned yet; the nightly backup job (§8) will own retention. (§8)
- **Schema starts empty.** `src/schema.ts` and an empty migration journal are committed. Real tables arrive with the core schema (#26), so this task adds no throwaway table. Migration tests build their own fixture migrations: fresh DB, existing DB, backup, rollback. (§4, §10)

## 2026-10-31: Installable PWA (#19)

- **vite-plugin-pwa `~2.0.0` in `generateSW` mode, with `workbox-window` as its peer.** This is the §2 choice. Workbox precaches the built shell (JS, CSS, HTML, icons, manifest) and answers navigations with `index.html`, so deep links work offline; `/api/*` and `/healthz` are never served from the cache. 2.0.0 had been out for four weeks; its only breaking change is the peer range for `@vite-pwa/assets-generator`, which isn't used here. (§2, §3.4)
- **`registerType: "prompt"`, never `autoUpdate`.** A new build installs in the background and waits. The "Update available" bar lets the user pick Reload or Later, so an update can't reload the page mid-workout. (§8)
- **Icons are committed PNGs from one `icon.svg`.** They come in 64, 192 and 512 px, plus a 180 px apple-touch-icon. The 512 px icon doubles as the maskable one, since the artwork sits inside the safe zone. They were rendered once by hand, so the build has no image dependency; `@vite-pwa/assets-generator` (sharp) can replace this if icons start changing often. (§7)
- **`navigator.storage.persist()` on every start**, skipped when storage is already persisted. The result isn't shown anywhere yet; the unsynced-data warning (#30) is where it will matter. (§3.4)
- **Installability is checked with Chrome's own installability check (the one DevTools shows), not Lighthouse.** Lighthouse 12 removed its PWA category, so there is no Lighthouse PWA audit left to run. (§10)

## 2026-10-31: Docker Compose packaging (#18)

- **One image, two stages, on `node:24.22.2-slim`.** The build stage installs pnpm with npm, runs `pnpm install --frozen-lockfile` and `pnpm build`, then `pnpm deploy --prod` copies the server with production deps only. The runtime stage holds that, the server `dist` and the web `dist`. No pnpm, TypeScript or dev deps ship (335 MB, most of it the Node base image). The Node tag matches `node@runtime` in the lockfile, so the container runs the same Node as dev and CI. Debian slim over Alpine: glibc gets the standard prebuilt binaries for native modules like better-sqlite3 (#20). (§2, §8)
- **Bind `0.0.0.0` in the container, publish on `127.0.0.1` only.** Inside a container the server has to listen on all interfaces for Docker to forward to it; `compose.yaml` publishes `127.0.0.1:${PORT:-3000}:3000`, so the host stays localhost-only per §8. Host networking was the alternative, but it shares the host's whole network stack with the container and works differently on Docker Desktop. (§8)
- **Runs as `node`, with `init: true` and a built-in healthcheck.** The image runs as the unprivileged `node` user. Compose's `init` adds tini so `docker compose down` stops the container straight away instead of waiting out the 10 s kill timeout. The `/healthz` healthcheck lives in the `Dockerfile` and uses Node's `fetch`, since the slim image has no curl. (§8)
- **Data in a named volume at `/data`.** It is ready for the SQLite file (#20) and survives `docker compose down`. Backups (§8) will read from it. (§8)
- **CI builds both architectures on native runners.** A `Docker image` job runs on `ubuntu-24.04` and `ubuntu-24.04-arm` (free for public repos) instead of emulating arm64 with QEMU, which would make native-module builds slow. Each run builds the image, starts it and checks `/healthz` and the web app. Nothing is pushed to a registry until a host exists (#23). It uses `docker/setup-buildx-action@v4` and `docker/build-push-action@v7`, with layers cached per architecture in the GitHub Actions cache. (§8, §10)

## 2026-10-30: CI on pull requests (#7)

- **One GitHub Actions job on `ubuntu-latest`.** It runs on PRs to `main` and pushes to `main`: frozen-lockfile install, then `lint`, `format:check`, `typecheck`, `test`, `build`, the same commands as local dev. One job keeps a single required check (`Lint, test and build`) for the `protect-main` ruleset; the steps are cheap enough that splitting them into parallel jobs isn't worth the extra installs yet. No arm64 or macOS matrix until something platform-specific (better-sqlite3) lands. (§2, §10)
- **Node comes from `devEngines.runtime`, not `actions/setup-node`.** `pnpm/action-setup@v6` installs the pnpm 12 standalone binary from `packageManager`, and `pnpm install` downloads the pinned Node, so CI runs the exact Node in the lockfile. `pnpm/setup` (installs pnpm and the runtime in one step) was considered; it is newer, and the older action already covers this. The pnpm store is cached on the lockfile hash. (§2)
- **Least privilege.** The workflow token is read-only (`contents: read`), and a newer push to the same branch cancels the older run. Actions are pinned to major tags from GitHub and the pnpm org. (§10)

## 2026-10-30: Test runner (#6)

- **Vitest for unit and integration tests.** SPEC §5.6 and §10 call for table-driven, property (fast-check) and simulation tests but don't name a runner. Vitest is the standard for Vite projects: it reuses each package's Vite config and TypeScript handling, so there is no separate Babel or ts-jest setup, and it runs the same way for the server, the web app and the future `packages/*`. Jest was the alternative; it needs its own TypeScript and ESM transform. Playwright stays the E2E tool per §10. (§5.6, §10)
- **One root config with per-package projects.** `vitest.config.js` treats every folder in `apps/*` and `packages/*` as a project, so `pnpm test` is one run with one report and new packages are picked up automatically. Pinned `~5.0.5`. (§10)
- **Server routes split into `app.ts`.** `index.ts` only starts the listener, so tests exercise the real Hono app with `app.request()` and no open port. `tsconfig.build.json` excludes tests from the build. (§10)

## 2026-10-30: Linting and formatting (#5)

- **ESLint 10 + typescript-eslint, with Prettier for formatting.** The standard pairing for a React + TypeScript + Vite project, and what the TypeScript 6.0 pin was made for. One root `eslint.config.js` covers every package: `@eslint/js` recommended, typescript-eslint `recommendedTypeChecked` (catches floating promises and unsafe `any`, which matter for sync and engine code), and `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh` for `apps/web`. Biome (one faster tool for both) was considered and rejected: its type-aware linting is newer and narrower than typescript-eslint's, and the React rules here come from the React team's own plugin. (§2, §10)
- **Prettier defaults, no style rules in ESLint.** `.prettierrc.json` is empty so editors pick Prettier up; the lockfile is ignored. None of the configs used enable formatting rules, so `eslint-config-prettier` isn't needed. (§10)
- **ESLint pinned `~10.13.0`.** 10.14.0 came out the day this landed; take it once it has settled. (§10)

## 2026-10-30: pnpm installs the Node runtime

**Decision:** pin Node in `devEngines.runtime` (`24`, `onFail: download`) so `pnpm install` fetches it into `node_modules` and records the exact version and per-platform checksums in the lockfile. Every `pnpm` script then runs on that Node. A pnpm without a system Node (standalone installer) failed `pnpm dev` with `exec: node: not found`; this removes the separate Node install step and keeps the version identical on the laptop, the host and CI. `.nvmrc` and `engines` stay for editors and tools that run outside pnpm. (§2)

## 2026-10-30: Hello world scaffold toolchain (#4)

- **Node 24 LTS (Krypton), not 26.** Node 26 only entered LTS on 2026-10-28; 24 is the mature LTS and native modules like better-sqlite3 reliably ship prebuilds for it. Pinned in `.nvmrc` and `engines`. Revisit in 2027. (§2)
- **pnpm 12, pinned via `packageManager`.** Current major. Dependency build scripts are off by default; `esbuild` (via `tsx`) is explicitly denied in `allowBuilds` because it ships its binary as an optional dependency and doesn't need its postinstall. (§2)
- **TypeScript 6.0, not 7.** TS 7 (the native port) is `latest`, but typescript-eslint, needed for #5, supports only `<6.1.0`. Pinned to `~6.0.3`; move to 7 once the lint toolchain supports it. (§2, §10)
- **Minimal skeleton.** Only `apps/web` (React + Vite) and `apps/server` (Hono, `/healthz`, serves the built client) exist. Tailwind, Dexie, vite-plugin-pwa, SQLite/Drizzle and the `packages/*` libraries arrive with the first task that needs them, per the §2 stack. The server binds `127.0.0.1` by default. (§2, §8)

## 2026-10-30: Platform and stack (#3)

**Decision:** an installable PWA (iPhone at the gym, laptop browser at home) backed by a self-hosted Node server, using the stack in SPEC §2. Approved by the owner with the spec. (§2, §3.4, §8)

Options considered:

- **PWA + self-hosted Node/SQLite (chosen).** One TypeScript codebase for client, server and engine, so the engine runs offline on the phone and authoritatively on the server. Works on iPhone and laptop from one build. No App Store or Apple developer fee; deploys like any other homelab service. Costs: iOS PWA limits (no Background Sync, no HealthKit or Bluetooth, possible storage eviction, unreliable timers when the screen is locked), mitigated per §3.4 and §11. Offline needs HTTPS, hence Tailscale Serve.
- **Native iOS (Swift/SwiftUI).** Best device integration: HealthKit, background GPS, reliable timers and notifications. Rejected: iPhone only (the laptop view needs a second client), App Store/TestFlight distribution or re-signing sideloaded builds, and the engine would have to be written twice or run server-side only, which breaks offline adaptation. HealthKit and live wearables are v1 non-goals anyway.
- **React Native / Expo.** Shares TypeScript with the server and reaches native APIs. Rejected for v1: still needs iOS signing and distribution, adds a mobile build toolchain, and the laptop view needs react-native-web or a separate app. Revisit if HealthKit or in-app GPS recording becomes a goal.
- **Storage within the chosen option:** SQLite over Postgres. Single user, one file to back up, light enough for a Pi-class host.

## 2026-10-30: Spec review (Draft v1 → v2)

- **Stack approved.** The stack in SPEC §2 is approved. Anything outside the spec still needs owner sign-off.
- **Dumbbell-first equipment.** The owner mostly trains with dumbbells: 5–120 lb in 5 lb steps. Barbells come only in fixed 10 lb steps. Barbell, cable and machine movements default to dumbbell or band variants. Loads progress by reps, sets or tempo when the next dumbbell step is too large or doesn't exist. (§2, §5.1)
- **One global block calendar.** It covers all modalities so the owner doesn't juggle separate rhythms. Early and reactive deloads move it for everything, and race mode owns it while active. Views can drill into one modality. (§2, §5.1, §5.4, §6)
- **Weekly rollover is Sunday night, local time.** The server generates next week on the first sync after rollover. Until then, the phone runs a provisional plan. (§3.2)
- **Running volume is tracked in miles.** The long-run cap stays a time limit. (§2, §5.2)
- **No warm-start importer.** The owner has no spreadsheet (he used a lifting app). Onboarding collects working weights instead. (§12 Q6)
- **Double progression adds load only at RIR ≥ target.** v1 said "at or below", which rewarded grinding. (§5.1)
- **Increment and cut rules apply to `double_progression` only.** `e1rm_rir` progresses through its e1RM update alone. A miss holds the load at the next exposure in both models, overriding the block's RIR step. (§5.1, §5.6)
- **Pain flags use one region list.** It's shared with `stress_tags`, with a severity ladder: 1–3 freezes progression, 4+ swaps or excludes the exercise. Running and climbing get their own responses. (§4, §5.1–5.5)
- **Plan ownership.** The server owns plan rows. Offline changes on the phone are client-owned `plan_override` rows that the server validates and supersedes. (§3.1, §3.2, §4)
- **Sync LWW is ordered by server receipt** (`server_seq`), not client clocks. (§2, §3.2)
- **Readiness thresholds.** Readiness is a composite z-score: green ≥ −0.5, yellow down to −1.5, red below that. Engines treat readiness as green until the check-in ships in Phase 5. (§5.5)
- **Templates carry intensity class and intent**, which the scheduler needs. (§4, §5.4)
- **AM and PM slots satisfy the 6-hour gap.** The "one light day" rule is now a hard constraint. (§5.4)
