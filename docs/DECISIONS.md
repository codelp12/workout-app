# Decisions

Newest first. Each entry gives the decision, why it was made, and the spec section it affects.

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
