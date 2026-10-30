# Agent guidance

- Read `docs/VISION.md` before proposing features; respect its out-of-scope list (no social/bloat features).
- The tech stack is not chosen yet. Do not introduce frameworks or dependencies without the owner agreeing to the choice first.
- Once a stack exists, keep lint/test/build commands documented here.

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
