# Agent guidance

- Read `docs/VISION.md` and `docs/SPEC.md` before proposing features; respect the out-of-scope and non-goals lists (no social/bloat features).
- `docs/SPEC.md` is the source of truth. Its defaults, including the stack in Section 2, are owner-approved. Anything it doesn't cover (new dependencies, scope changes, changed defaults) needs owner sign-off on an issue or PR first.
- Log decisions in `docs/DECISIONS.md`.
- Keep lint/test/build commands documented here.

## Commands

pnpm 12 (`packageManager` in `package.json`). Node 24 comes from `devEngines.runtime` in `package.json`, which `pnpm install` downloads; keep `.nvmrc` and `engines` in sync with it. Run from the repo root:

- `pnpm install`: install all workspace deps.
- `pnpm dev`: web (Vite, :5173) + server (Hono, :3000) with hot reload.
- `pnpm build`: typecheck and build every package.
- `pnpm start`: run the built server, which also serves the built web app.
- `pnpm typecheck`: typecheck every package.
- `pnpm test`: run every test once with Vitest. `pnpm test:watch` reruns on change.
- `pnpm lint`: ESLint (typescript-eslint type-checked rules, plus React hooks/refresh rules in `apps/web`) over the whole repo. `pnpm lint:fix` applies autofixes.
- `pnpm format`: format everything with Prettier (default options). `pnpm format:check` checks without writing; run it before pushing.

Tests are `*.test.ts(x)` files next to the code they cover. The root `vitest.config.js` runs each folder in `apps/*` and `packages/*` as its own Vitest project, using that package's `vite.config.ts` if it has one. The server keeps its routes in `src/app.ts` so tests can call `app.request()` without opening a port; `tsconfig.build.json` keeps test files out of `dist`.

Lint config is `eslint.config.js` at the root; Prettier skips `.gitignore`d files and anything in `.prettierignore`. Formatting is Prettier's job, so don't add style rules to ESLint.

CI (`.github/workflows/ci.yml`) runs on every PR to `main` and every push to `main`: `pnpm install --frozen-lockfile`, then `lint`, `format:check`, `typecheck`, `test` and `build`. Run the same commands locally before pushing; the `protect-main` ruleset requires the `Lint, test and build` check to pass. If you rename the job, the owner has to update the ruleset.

Dependency build scripts are blocked unless listed under `allowBuilds` in `pnpm-workspace.yaml`; adding one there needs a reason.

## Workflow

- `main` is protected. Never push to it; all work goes on a feature branch and lands through a PR the owner reviews and merges.
- One PR per task issue where possible. Put `Closes #<issue>` in the PR body so the issue closes on merge.
- Fill in `.github/pull_request_template.md`.

## Tickets

Work is tracked in GitHub Issues and the project board.

- **Epic** (`epic` label): a user-facing feature. Its body lists its tasks as a checklist (`- [ ] #12`) and the tasks are added as sub-issues.
- **Task** (`task` label): one PR-sized unit of work; names its parent epic.
- **Bug** (`bug` label): something broken.
- When asked to write tickets, use the templates in `.github/ISSUE_TEMPLATE/`, create the epic first, then its tasks, then update the epic's checklist with the task numbers.
