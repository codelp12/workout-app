# Agent guidance

- Read `docs/VISION.md` and `docs/SPEC.md` before proposing features; respect the out-of-scope and non-goals lists (no social/bloat features).
- `docs/SPEC.md` is the source of truth. Its defaults, including the stack in Section 2, are owner-approved. Anything it doesn't cover (new dependencies, scope changes, changed defaults) needs owner sign-off on an issue or PR first.
- Log decisions in `docs/DECISIONS.md`.
- Keep lint/test/build commands documented here.

## Commands

Node 24 (`.nvmrc`), pnpm 12 (`packageManager` in `package.json`). Run from the repo root:

- `pnpm install`: install all workspace deps.
- `pnpm dev`: web (Vite, :5173) + server (Hono, :3000) with hot reload.
- `pnpm build`: typecheck and build every package.
- `pnpm start`: run the built server, which also serves the built web app.
- `pnpm typecheck`: typecheck every package.

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
