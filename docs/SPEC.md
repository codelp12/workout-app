# Training Planner: Implementation Game Plan

_Self-hosted lifting, running and climbing planner · Draft v2 · October 30, 2026_

## 0. How to use this document

This is the product spec and build plan for a private, single-user training app, written to be handed to an implementing agent. Treat it as the source of truth.

- The owner has approved this spec, including the stack in Section 2. Where a section states a **Default**, proceed without asking. Where Section 12 lists an open question, use its default, log the choice in `docs/DECISIONS.md`, and keep going unless the answer would force a rewrite.
- Anything this spec doesn't cover (new dependencies beyond Section 2, scope changes, changing a stated default) needs owner sign-off on an issue or PR first. All work lands through PRs the owner reviews (see `AGENTS.md`).
- The owner is a software engineer who is comfortable with self-hosting and homelab setups. Expect real code review, prefer boring and well-documented dependencies, and skip the hand-holding.
- Build in vertical slices following Section 9. Every phase ends with something usable at the gym, a green test suite and a deployed build. Do not start a phase until the previous one meets its acceptance criteria.
- The coaching engine (Section 5) is the differentiator. Build it as a pure, deterministic, heavily tested library before wiring it into the UI.
- The training rules below are conservative defaults and heuristics, not medical advice. Implement them as written, keep every threshold in one config module, label heuristics as such in code, and add no ML or LLM-driven decisions without owner approval.
- Host hardware is undecided (a Raspberry Pi-class device and several desktops are available). Keep the build runnable on arm64 and amd64 and light enough for a Pi.

## 1. Product brief

**Problem.** Paid training apps are bloated with social features and narrowly specialized. Liftoff-style apps, as the owner experiences them, assume every session is last PR plus 5 lb; Runna-style plans cover only running; nothing plans lifting, running and climbing as one coherent week. Spreadsheets work until they get ugly, and they can’t plan or explain.

**Vision.** A private, self-hosted PWA that plans and logs 11 sessions a week (6 lifting, 3 running, 2 climbing), shows last week beside this week’s targets, explains every target, and works offline at the gym.

**Goals**

1. One place to plan, perform and review all training, so the stack of single-purpose apps (and any spreadsheet) goes away.
2. Coherent planning: progressive overload per modality, one weekly schedule that protects recovery across modalities, and a shared deload rhythm.
3. Smarter than “last PR plus 5 lb”: targets come from performance, effort (RIR/RPE), trend and readiness, and each carries a plain-English reason.
4. Offline-first at the gym, syncing when home (or over VPN).
5. A clean, fast mobile UI with exercise photos, cues and descriptions, plus a spreadsheet-style grid for when the owner wants raw numbers.

**Non-goals (v1).** Social features, multi-user UI, payments, a native iOS app, HealthKit or live wearable integration, nutrition tracking, public internet exposure, LLM-made training decisions.

**Success criteria**

- A full week (all 11 sessions) is performed and logged on an iPhone in airplane mode, then syncs on reopening at home with no loss or duplicates.
- A typical set is logged in two taps or fewer, with values prefilled from the target (from last time until the engines land in Phase 2).
- At each weekly rollover (Sunday night) the app generates next week’s plan, and every target has a “why”.

## 2. Defaults at a glance

- **Client:** React + TypeScript + Vite PWA, Tailwind CSS, Dexie (IndexedDB), vite-plugin-pwa (Workbox). Installed to the iPhone home screen; also runs in the laptop browser.
- **Server:** Node LTS + TypeScript, Hono, SQLite (better-sqlite3 + Drizzle), zod. One process serves the API and the built PWA.
- **Repo:** pnpm monorepo with `apps/web`, `apps/server`, `packages/engine`, `packages/shared`, `packages/exercise-data`.
- **Engine:** pure TypeScript shared by server and browser, so in-session adjustments work offline.
- **Sync:** offline-first; client outbox plus server change feed; last-write-wins per record, ordered by server receipt rather than client clocks (single user, so conflicts are rare).
- **Auth:** single user (passkey or password, see Section 8), with `user_id` on every row so nothing blocks multi-user or internet exposure later.
- **Units:** lb, miles, min/mile; running volume is tracked in miles. Store the entered value and unit per record; the engine normalizes.
- **Lifting split:** Push/Pull/Legs twice a week, editable templates.
- **Week and calendar:** weeks run Monday to Sunday and roll over Sunday night, local time. One shared block calendar (loading, deload, test and taper weeks) drives all three modalities.
- **Running:** open-ended 4-week blocks with periodic time trials; optional race goal.
- **Climbing:** indoor bouldering on the V-scale; route mode (YDS) optional.
- **Equipment:** dumbbell-first. Dumbbells 5–120 lb in 5 lb steps, fixed barbells in 10 lb steps, resistance bands. Barbell, cable and machine movements default to their closest dumbbell or band variant. Editable in settings.
- **Hosting:** Docker Compose (or systemd) on the home server, HTTPS via Tailscale Serve.

## 3. Architecture

### 3.1 Shape

- The home server is the source of truth and owns plan generation. The phone may compute _provisional_ plan changes offline (in-session trims, moved sessions, replans, next week's plan) with the shared engine. These are stored as client-owned `plan_override` rows, and the server's recomputation wins on the next pull.
- Each client (iPhone, laptop) keeps a local IndexedDB copy sufficient to run about two weeks of sessions offline: plan, exercise library with core images, recent history, and an outbox of unsynced writes.
- Every write is applied locally first (optimistic UI), queued in the outbox, and pushed when the server is reachable.
- The in-progress workout is persisted to IndexedDB after every set. iOS can kill the app at any time, and the player must resume exactly where it left off.

### 3.2 Sync protocol

- Client-generated UUIDv7 ids for every created record. Every row has `updated_at`, a soft-delete tombstone and a server-assigned `server_seq`.
- `POST /api/sync/push` takes a batch of ops `{opId, entity, action, data}`. The server applies each idempotently (dedupe on `opId`), re-runs the engine for affected exercises and weeks, and returns a new cursor.
- `GET /api/sync/pull?since=<cursor>` returns changed rows and tombstones, including regenerated plan rows.
- Conflicts resolve by last-write-wins per record, ordered by server receipt (`server_seq`). Client `updated_at` is informational only, since phone clocks drift.
- Plan rows are server-owned. Client-side plan changes are pushed as `plan_override` ops; the server validates them, may adjust them, and returns regenerated plan rows that replace the provisional ones.
- **Weekly rollover** is Sunday night in the owner's local timezone. The server generates the next week on the first sync after rollover, using every log it has. Until then, the phone runs the next week from a provisional plan it generated locally, and the server's version replaces it on pull.
- A 401 during sync never touches the outbox or blocks logging: show a "Sign in to sync" chip and keep queuing.
- Sync on app open or foreground, the `online` event, workout completion, and a manual button. Show a status chip (Synced, N pending, Offline). Never block logging on the network.
- In-session adaptation (for example, set 1 was harder than planned, so trim the remaining sets) runs on-device with the shared engine.

### 3.3 Reachability and HTTPS (prove this first)

- Service workers, which offline support depends on, need a secure context, so the app must be served over HTTPS. Plain `http://192.168.x.x` will not give offline support on iOS.
- At the gym the phone is off the home network, so offline logging is mandatory. A VPN is a convenience that also lets the phone sync from anywhere.
- **Default:** run Tailscale on the server and devices and publish the app with `tailscale serve` at `https://<server>.<tailnet>.ts.net`. HTTPS certificates must be enabled for the tailnet, and the app should listen on localhost only. A VPN is on the owner’s wider homelab roadmap, so this doubles as groundwork. Alternatives: Caddy with a real domain and DNS-challenge certificates, or a local CA (mkcert or step-ca) with its root installed on each device. Public exposure (Funnel) is out of scope for v1.

### 3.4 iOS PWA constraints (checked October 2026; re-verify before relying)

- No Background Sync on iOS Safari, so sync is foreground-triggered only.
- Install is manual (Share, then Add to Home Screen). Installed PWAs get steadier storage than Safari tabs but can still be evicted, so call `navigator.storage.persist()`, sync promptly, show an “N unsynced sessions” warning, and offer “export unsynced data to a file” as a last resort.
- Timers and notifications are unreliable with the screen locked. Compute the rest timer from timestamps on resume, use audio or visual cues only while foregrounded, and use the Screen Wake Lock API during sessions (test on device).
- No HealthKit or Bluetooth from the web. Wearable data arrives later via FIT/GPX/TCX file import.
- Playwright’s WebKit approximates Safari but is not iOS, so keep a real-device smoke checklist.

## 4. Data model

All rows carry `id`, `user_id`, `created_at`, `updated_at`, `deleted_at` and `server_seq`. Store weights as the entered value plus unit, timestamps in UTC, and the local training date and timezone alongside.

- `settings`: units, equipment inventory (dumbbell range and step, fixed barbell weights, bands; optional bar, plates and stack steps), weekly availability (per weekday: AM/PM slots, gym access), preferences (long-run day, lift-free day), goals, engine config overrides.
- `exercise`: name, aliases, modality (lift, run, climb, mobility), movement pattern, primary and secondary muscles, equipment, compound or isolation, unilateral, default progression model, increment and rep range, `stress_tags` from the shared body-region list (neck, shoulder, elbow, wrist, fingers, upper back, low back, hip, knee, shin, ankle/foot), `substitution_group`, instructions, cues, common mistakes, media, source and license.
- `template`: reusable session definitions (for example Push A) with ordered slots: exercise or substitution group, sets, rep range, target RIR, rest, `ramp` flag. Each template also carries an intensity class (heavy, moderate or light) and an intent (key, support or recovery) for the scheduler.
- `block` and `week`: the single global calendar shared by every modality (loading, deload, taper, test) and `engine_version`.
- `planned_session` (date, slot, modality, workout type, intent key/support/recovery, status planned/done/skipped/moved, generated-by) and `planned_item` (an exercise, run segment or climbing block, with targets and `reasons[]`).
- `plan_override`: client-owned provisional plan changes (move, trim, swap, provisional week) with the op that created them; superseded when the server regenerates the affected plan rows.
- `session_log` (modality, start and end, session RPE 1–10, notes, link to plan) with children `set_log` (exercise, index, load, unit, reps, RIR, warm-up flag), `run_log` (distance, duration, optional heart rate and elevation, RPE, workout type, splits) and `ascent` (grade, style flash/onsight/send/attempt, attempts, tags, project).
- `project`: climbing projects with attempts across sessions.
- `readiness_checkin`: date, sleep, energy, soreness by region, pain flags (body region from the `stress_tags` list, severity 0–10), optional resting HR, HRV and bodyweight.
- `fitness_state`: time series of e1RM per lift (with confidence), VDOT and paces, climbing volume and limit grades.
- `engine_decision`: inputs, rules fired, outputs and `engine_version` per prescription; powers “Why this?” and debugging.
- `op_receipt`: processed client `opId`s.

## 5. The coaching engine

### 5.0 Principles

Terms: RIR is reps in reserve, RPE is rating of perceived exertion, e1RM is estimated one-rep max.

1. Pure, deterministic and versioned: `(state, history, config, today) → decisions`. No I/O, no clock reads, no randomness.
2. Transparent rules, not black boxes. Every decision emits `reasons[]` (code plus plain English), shown in a “Why this?” sheet.
3. Slow to increase, quick to back off. A pain flag beats progression every time.
4. All thresholds live in one documented config module, overridable per user.
5. Cold start: onboarding collects recent working weights with effort, a recent run effort and climbing grades. The first two weeks run in calibration mode (smaller jumps, wider tolerance).
6. A language model may later narrate engine output. It never decides.

Each modality implements `ModalityEngine { initState, prescribe(state, intent, ctx), update(state, sessionLog), reviewWeek }`. Phase 1 ships static-template stubs behind this interface so the real engines drop in without UI changes. Budget: a prescription in under 50 ms on a phone.

### 5.1 Lifting (6 sessions per week)

**State per exercise:** e1RM estimate with confidence, last N exposures, stall count, date of last increase.

**Two progression models**, chosen per exercise (default by movement type):

- `e1rm_rir` for main compounds (dumbbell squat or split squat, dumbbell bench, RDL, overhead press, rows). The prescription is sets × reps at a target RIR. Load = e1RM ÷ (1 + (reps + RIR) / 30), which is Epley with reps adjusted for RIR, rounded to a loadable weight. After a session, take the best hard set’s e1RM as the session estimate (ignore sets where reps + RIR exceeds 12), then update with asymmetric smoothing (defaults: α 0.3 up, 0.5 down) and cap any single-exposure rise at +3%.
- `double_progression` for accessories and isolation work. Use a fixed rep range (for example 8–12) and hold the load until every working set reaches the top of the range at RIR at or above target (no grinding past the planned effort). Then add the smallest increment and drop back toward the bottom of the range.

**Block structure.** Default 4-week mesocycle: three loading weeks, then a deload (configurable 3–6 weeks). Main-lift target RIR steps 3 → 2 → 1 across the loading weeks. Longer blocks spread the same range (for example 3, 2, 2, 1, 1 for five loading weeks). Template slots flagged `ramp` (default: the first two per session) gain one set in loading weeks 2 and 3 if the prior week’s targets were met and readiness isn’t red; cap hard sets per muscle group per week (default 20). Deload week: half the sets (rounded up), about 90% of week-1 load, RIR 3 or more. The next block restarts at RIR 3 from the updated e1RM, so loads climb block over block. Blocks and deloads sit on the global calendar shared with running and climbing (see 5.4).

**Rules** (all configurable). Increment and cut rules apply to `double_progression`. For `e1rm_rir`, performance feeds the e1RM update above, so there are no extra increments or cuts. The hold rule, stall counter and plateau handler apply to both models.

- Every working set beat the target reps, or RIR was 2+ above target: `double_progression` takes double the usual increment next time, capped at +5% of load; `e1rm_rir` relies on the e1RM update and its +3% cap.
- Missed target reps at the prescribed load: hold that load at the next exposure. This overrides the block's RIR step and the e1RM-derived load. A second consecutive miss: `double_progression` cuts load 5–10%; `e1rm_rir` re-derives load from its lowered e1RM. Either way, flag a stall. Three stalls: run the plateau handler (change the rep scheme, swap to a same-group variation for one block, or add a back-off set). Call an early deload if two or more main lifts stall in one block. An early deload moves the global calendar for all modalities.
- Reactive deload: pull the deload forward when at least two of these hold: e1RM falling on two or more main lifts, session RPE rising with flat performance, readiness yellow or red on 3+ of the last 7 days, persistent soreness. Never in the first two weeks of a block, and at most once per block. It moves the global deload for all modalities.
- Layoff re-entry: 7–13 days missed means −5–10% for the first session back; 14+ days means −15–20% for a week, then ramp, with e1RM recalibrated.
- Equipment-first selection: templates and substitutions prefer dumbbell, band and bodyweight variants. Barbell, cable and machine movements are swapped for the closest dumbbell or band variant in the same `substitution_group` unless the owner pins them.
- Increments by equipment (defaults): dumbbells one 5 lb rack step, fixed barbells one 10 lb step, bands one band level, cable or machine one stack step if ever configured. Per-exercise overrides. Never prescribe a load the equipment can't make. When the next step is too big a jump (for example 5 lb on a 15 lb dumbbell) or doesn't exist (past 120 lb), progress reps, sets or tempo instead, or move to a harder variation such as unilateral.
- Warm-ups: ramp through roughly 40, 60 and 80% of the first working load, rounded to available weights; skip them for later exercises that share a movement pattern.
- Pain flags follow the ladder in 5.5. At 1–3/10, freeze increases on exercises whose `stress_tags` include the flagged region. At 4+/10, swap in a same-group substitute without that tag, or drop the exercise.

**Default split:** Push/Pull/Legs twice a week, five to seven exercises per session, so each muscle group is trained twice weekly. Other splits are template edits; the scheduler (5.4) only needs session type and intensity class.

**Review data:** per exercise, last week’s top set and total reps, e1RM change, this week’s target with its reason; weekly hard sets per muscle group.

### 5.2 Running (3 sessions per week)

**State:** VDOT (with date and source), derived paces, recent weekly volume, current progression step per quality type, last long run.

**Paces.** Compute VDOT from a recent race or time trial with the Daniels–Gilbert equations, where v is metres per minute and t is minutes:

- VO2 = −4.60 + 0.182258v + 0.000104v²
- %VO2max = 0.8 + 0.1894393e^(−0.012778t) + 0.2989558e^(−0.1932605t)
- VDOT = VO2 ÷ %VO2max

Training paces solve for v at a fraction of VDOT (approximate defaults: Easy 62–70%, Marathon 80%, Threshold 88%, Interval 100%, Repetition 105%). Test fixture: a 20:00 5K gives a VDOT of about 49.8. Show paces as ranges with RPE and talk-test cues, since hills, heat and fatigue skew pace.

**Weekly shape (3 runs):** one quality run (threshold weeks alternate with interval weeks; hills optional), one easy run (optional strides), one long run.

**Quality progression.** Generate sessions from a work total W (distance at the target pace) instead of hard-coding workouts. Caps scale with weekly volume (Daniels-style defaults; verify against the book): threshold W ≤ 10% of weekly distance; interval W ≤ the lesser of 8% of weekly distance and 10 km (6.2 mi); repetition W ≤ the lesser of 5% and 8 km (5 mi); floor of about 10 minutes of work. Step W up roughly 10–15% per exposure and lengthen reps over time (for example 3×6 min, then 2×10 min, then a 20-minute continuous tempo). Advance after a completed session at or below target RPE, repeat if RPE exceeded target by more than 1, step back after a failed session or a red readiness day.

**Volume progression.** Weekly volume is measured in miles; the long-run cap below is a time limit. Start from the trailing four-week average. Weekly volume rises at most 10% (5% in the first two weeks or on yellow readiness), with a cutback of 20–25% in every deload week. The long run is 35–45% of weekly volume (higher than usual because there are only three runs), capped at 150 minutes and +10–15 minutes per week. Never ramp volume, quality work and the long run aggressively in the same week.

**Open-block mode (default).** Rolling 4-week blocks with a fitness check (5K or 30-minute time trial) every 6–8 weeks. VDOT rises only from races or time trials the owner flags, and drops if three consecutive quality sessions fail at target RPE.

**Race mode (optional).** Goal distance, date and optional target time. Race mode owns the global calendar while active, so lifting and climbing deloads line up with its phases and taper. Build phases backward from race day: base, build, specific, taper (last 1–2 weeks at 25–40% less volume with intensity kept). Warn if the target time is unrealistic against VDOT, or if lead time is under the minimum (defaults: 6, 8, 12 and 16 weeks for 5K, 10K, half and marathon).

**Post-run feedback:** planned versus actual distance, duration and pace; easy runs more than 10–15 seconds per mile faster than easy pace get a “slow down” note; rep-pace consistency on quality runs; weekly volume versus plan. Missed runs are never made up by stacking mileage.

**Pain flags** (ladder in 5.5): at 1–3/10 on a lower-body region, freeze volume and quality progression. At 4+/10, replace runs with non-impact aerobic work or rest.

### 5.3 Climbing (2 sessions per week)

This is the least evidence-based engine of the three. Keep it modular, treat thresholds as heuristics, and remember that good logging matters more than clever prescriptions.

**State:** `limit_grade` (hardest grade sent in the last 6 weeks), `volume_grade` (highest grade with 3+ sends in one session in the last 3 weeks), 4-week grade pyramid, project list, weekly hard-attempt count. Grades map to a numeric index (V0 = 0, V1 = 1, and so on; a configurable YDS table for routes). Mappings are approximate.

**Session types**

- **Limit session** (1 per week, a key session). Warm-up pyramid of 6–8 problems well below limit, then 3–5 problems from limit−1 to limit+1 with 3–5 minute rests, capped at 10–12 hard attempts, stopping when quality drops. Raise the target band one grade after two consecutive limit sessions in which the owner sends at limit+1 or sends limit-grade problems within three attempts.
- **Volume session** (1 per week). Pyramid or 4×4 at volume grade −1 to −2 with short rests. Add sends first; after two sessions at RPE 7 or below, shift a third of the problems up one grade.

**Emphasis rule.** If limit minus volume grade is more than 2, tilt content toward volume; if 1 or less, tilt toward limit attempts. Deload week: no attempts above limit−2 and fewer problems.

**Off by default (later modules):** ARC sessions (20–30 minutes of easy continuous climbing) as a warm-up or cool-down, and hangboard work (at most 2 per week, 48 hours apart, conservative load steps, disabled by any finger pain flag). Pull days in the lifting plan already load fingers and forearms, so do not enable these without owner sign-off.

**Logging UX:** tap grade chips to add sends, long-press for flash or attempts, tag style (slab, overhang, crimp and so on), track projects across sessions.

**Pain flags** (ladder in 5.5): at 1–3/10 on fingers, wrist, elbow or shoulder, cap attempts at limit−2. At 4+/10, swap to an easy volume session well below limit, or rest.

### 5.4 Weekly scheduler

Eleven sessions in seven days means at least four double-session days, so scheduling and recovery are first-class features.

**Inputs:** sessions to place (6 lifts by type, 3 runs by type, 2 climbs by type), the availability matrix (weekday plus AM/PM), and the last 72 hours of history. Each session has an intent class: key (quality run, long run, limit climb, heavy legs), support, or recovery. Lifting sessions take their intent and intensity class from the template.

**Hard constraints:** at most 2 sessions per day, at most 1 per modality per day, same-day sessions in separate slots (AM and PM, which counts as at least 6 hours apart), availability respected, and at least one day per week with at most one easy session.

**Soft constraints** (penalty weights in config):

- Quality or long run within 24 hours after a Legs day, or a Legs day the day after a long run: high.
- Run and Legs on the same day: medium (low if the run is easy and in the morning with lifting in the evening).
- Limit climb on a Pull day or the day after one: high; volume climb on a Pull day: medium.
- Key sessions on consecutive days: medium; three in a row: high.
- Long run on the owner’s preferred day (default weekend): bonus.

**Algorithm.** Exhaustive search with pruning over the lift-free day, the lift-type rotation and run/climb placement (roughly 100k to 1M candidates; target under 300 ms on a phone, falling back to beam search if not). Score is the sum of penalties. Return the best plan plus two alternates, each session with a one-line explanation (for example, “Tuesday AM: easy run is 36 hours before Legs”).

**Block calendar.** One global calendar of loading, deload, test and taper weeks drives every modality. A reactive or stall deload moves it for all three, and race mode owns it while active.

**Replanning.** On a miss or move, re-optimize the remaining days with completed sessions pinned. Never stack make-up volume. When sessions must be dropped, keep key sessions and trim support sessions first. If two or more sessions were missed in a week, repeat that week’s loads instead of progressing. The Week view allows drag-to-move with constraint warnings, and the owner can always override.

### 5.5 Readiness and daily feedback

Daily check-in (about 30 seconds): sleep (1–5), energy (1–5), soreness for legs, upper push, upper pull and forearms/fingers (0–3), optional motivation, and pain flags (a body region from the `stress_tags` list, 0–10). Resting HR, HRV and bodyweight are optional later inputs.

**Score** (heuristic). Z-score each input against the owner’s own 28-day baseline once 7+ days of data exist; neutral before that. Composite = mean of the z-scores for sleep, energy, inverted soreness and motivation if given. Defaults: green ≥ −0.5, yellow −0.5 to −1.5, red < −1.5 (config). Until the check-in ships in Phase 5, engines treat readiness as green. Output green, yellow or red with suggested changes:

- Green: proceed as planned.
- Yellow: +1 RIR on all lifts and cut about 20% of sets (rounded to whole sets); swap the quality run for a steady easy run; swap the limit climb for a volume session.
- Red, or any pain flag at 4/10 or higher: suggest easy aerobic work, mobility or rest, and exclude exercises that load the flagged region. If the same flag persists 7+ days, suggest seeing a clinician.
- Pain flag at 1–3/10: no swap, but freeze progression on work that loads the region (see each engine).

Suggestions are advisory: accepting updates the day’s plan, and overriding is logged without penalty.

**Post-session debrief** (five lines or fewer). Lifting: PRs (e1RM and rep PRs), targets met or missed, next-time target. Running: planned versus actual and an effort verdict. Climbing: pyramid, hardest send, project progress. Always: “on track”, “ahead” or “behind” for the week.

**Load tracking.** Session RPE (1–10) × minutes = session load. Track weekly load per modality and in total. Flag a weekly total more than 25% above the trailing 4-week average, or two consecutive weekly rises over 15%. Treat this as a soft warning only, since acute:chronic ratios are contested as injury predictors.

**Weekly review** at rollover (Sunday night): last week versus this week for every modality, what changed and why, compliance (done versus planned), load chart, weeks until the next deload.

### 5.6 Engine testing

- Table-driven unit tests per rule. Property tests (fast-check): loads are always loadable, a missed exercise’s load never increases at its next exposure, output is deterministic, caps hold.
- A simulation harness with synthetic athletes (noisy performance, fatigue, missed weeks) over 24+ weeks per modality. Assert plausible trajectories: no oscillation, stall handlers fire, deloads land on schedule, running volume never breaks its caps.
- Golden snapshots for plan generation (fixed inputs, fixed outputs), versioned with engine_version.

## 6. UX and screens

Mobile-first (390×844 baseline), one-handed, dark by default (gym lighting), large tap targets, tabular numerals, skeletons rather than spinners, one consistent color per modality. Use an accessible primitive set (Radix or shadcn-style) instead of hand-rolled widgets. Rule: if a feature doesn’t help plan, perform or review a session, it doesn’t ship.

1. Today: today’s sessions (AM/PM), readiness check-in, coach note, sync chip.
2. Week: one combined 7-day grid for all modalities, color-coded, with filters to drill into lifting, running or climbing alone; drag to move with constraint warnings, last-week versus this-week strip, deload indicator.
3. Lift player: swipeable exercise cards with photos, cue chips and a how-to sheet; target and “last time” lines; weight and rep steppers prefilled from the target; RIR picker (0–4); rest timer; load picker that only offers available weights (dumbbell rack, fixed barbells, bands); swap, skip, add set; collapsed warm-ups; “Why this target?” sheet.
4. Run: structured workout bars (warm-up, reps with paces, cool-down), manual entry now and file import later, RPE.
5. Climb: grade chips, project tracker, session timer, live pyramid.
6. Progress: e1RM chart and PR list per lift; weekly hard sets per muscle group; running volume, pace and VDOT; climbing pyramid and hardest sends; consistency calendar.
7. Log grid (the spreadsheet aspect): exercise × week matrix of top sets and targets, weekly tables for running and climbing, filters, CSV export.
8. Library: search and filter by muscle, equipment and movement pattern; detail page with photos, instructions, cues, common mistakes, personal notes and history.
9. Plan: current block on the shared calendar with per-modality detail, goals (race, target lifts), templates, availability.
10. Settings: units, equipment, schedule, export, backup status, engine config viewer, sync debug.

## 7. Exercise library and media

- Seed from free-exercise-db (github.com/yuhonas/free-exercise-db): Unlicense, roughly 870 exercises as JSON with instructions, primary and secondary muscles, equipment, difficulty and static photos rather than animations. It is a dataset, not an API: pin a commit, import locally, and never hotlink GitHub raw URLs. Spot-check image quality and keep per-asset source and license fields.
- Curate a “core” set (about 150 exercises covering the owner’s templates, dumbbell and band variants first) and pre-cache its images for offline use; load the rest on demand.
- Convert images to resized WebP (about 480 px wide) and cache core assets in the service worker within a size budget.
- Author custom content for run workout types (easy, long, tempo, intervals, hills, strides) and climbing sessions and drills (pyramid, 4×4, ARC, project attempts) as versioned JSON with simple SVG diagrams.
- Let the owner add personal cues, notes, photos or short clips per exercise, stored on the server and cached on the device.

## 8. Deployment, security and backup

- One Docker Compose service (or a systemd unit): Node serves the API and the built PWA, SQLite on a persistent volume, arm64 and amd64 images. The server listens on localhost (in Compose, publish as `127.0.0.1:PORT:PORT` or use host networking); Tailscale Serve provides HTTPS and tailnet-only access.
- Auth: single-user passkey or password (argon2id), HttpOnly Secure SameSite cookie, login rate limiting, no secrets in git, configurable base URL. Long sliding sessions (default 90 days), so an expired session never blocks offline logging (see 3.2). Tailscale identity headers are an optional extra layer, trusted only when the app listens on localhost.
- Backups: nightly SQLite online backup (.backup or Litestream) to a second disk or NAS, 14+ days retention, a documented restore drill, and CSV/JSON export in Settings.
- Migrations are forward-only (Drizzle) with an automatic pre-migration backup.
- PWA updates show an “update available” prompt and never reload mid-workout.
- Observability: structured logs, /healthz, the engine decision table.
- Later, not v1: internet exposure via Cloudflare Tunnel or Tailscale Funnel behind WebAuthn, rate limits and CSP. Nothing in v1 should preclude it.

## 9. Roadmap

Every phase ends usable, tested and deployed.

### Phase 0. Foundations and de-risking

- Scope: monorepo, lint/typecheck/test scripts, Docker Compose; confirm the host machine with the owner. Spike a “hello PWA” over HTTPS (Tailscale Serve), installed on the iPhone, with one record written in airplane mode. The agent can’t touch the phone, so hand the owner a short checklist and wait for results.
- Acceptance: the record appears on the laptop after reconnect; findings logged in docs/DECISIONS.md.

### Phase 1. Logging MVP (replace the current lifting app)

- Scope: exercise library seed and detail pages; Push/Pull/Legs templates; Today and Week views with manual placement; lift player (prefill from last time, rest timer, load picker); manual run and climb logging; history and log grid; sync v1; CSV export; engine interfaces with static stubs; onboarding for equipment and current working weights.
- Acceptance: a full week of all 11 sessions logged offline on the iPhone and synced with no loss or duplicates; a typical set takes two taps.

### Phase 2. Lifting engine v1

- Scope: e1RM, both progression models, blocks and deloads on the global calendar, equipment-first substitution, warm-ups, rounding, reasons, weekly lifting review.
- Acceptance: simulation tests pass; after sync, next week’s targets and reasons appear.

### Phase 3. Running engine v1

- Scope: VDOT onboarding and paces, volume and quality progression, long-run logic, open-block and race modes, post-run feedback.
- Acceptance: fixtures match published VDOT values; a simulated 12-week build respects every cap.

### Phase 4. Climbing engine v1

- Scope: logging UX, pyramid, level model, session templates, project tracker, weekly review.
- Acceptance: two weeks of real use produce sensible limit and volume sessions.

### Phase 5. Unified planner

- Scope: scheduler with explanations, replan on miss, reactive deloads that move the global calendar, readiness check-in, load tracking, debriefs, weekly review.
- Acceptance: the scheduler returns a valid week in under 300 ms, and every moved or dropped session has a stated reason.

### Phase 6. Polish and hardening

- Scope: charts, performance, accessibility, restore drill, auth hardening. Optional: FIT/GPX/TCX import, local-LLM narration of engine output, public-exposure design.
- Acceptance: restore drill passes, Lighthouse PWA checks pass, owner signs off.

## 10. Testing and quality

- Engine tests as in 5.6. Sync tests with two simulated clients, a flaky network, and duplicate or replayed ops against in-memory SQLite.
- E2E with Playwright (Chromium and WebKit), including offline mode, install and reconnect, plus mobile-viewport screenshots. Keep a real-iPhone checklist per release: install, offline launch, log a set, kill the app mid-workout and resume, sync, rest timer after screen lock, wake lock.
- Migrations tested against a copy of a seeded database.
- Definition of done for any task: typecheck, lint and tests green; migration included if the schema changed; docs and docs/DECISIONS.md updated.

## 11. Risks

- iOS PWA quirks (no Background Sync, storage eviction, unreliable timers): foreground sync, persistent storage requests, crash-safe in-progress sessions and an export fallback.
- Heuristics may not fit this athlete: transparent reasons, overrides, tunable config and conservative caps.
- Climbing model is the weakest: keep it modular and lean on logging.
- Data loss: nightly backups, a restore drill, CSV/JSON export.
- Scope creep: the non-goals list and the phase gates.
- Image licensing: per-asset metadata and a spot check before shipping.

## 12. Open questions (defaults apply until answered)

1. Which machine hosts it (Pi-class device or a desktop)? Default: Docker on whichever box the owner names in Phase 0.
2. Which weekday is lift-free, and which days and times (AM/PM) are available? Default: the scheduler chooses the lift-free day; all days available.
3. Running: current weekly volume, recent 5K or 10K time, any goal race? Default: open block; VDOT from a time trial in week 1. Volume is in miles.
4. Climbing: bouldering or routes, grade system, current limit and volume grades? Default: indoor bouldering, V-scale, onboarding questions.
5. Lifting: preferred and banned exercises, current working weights? Default: onboarding wizard.
6. Existing logs to import for a warm start? Answered: no spreadsheet; the owner used a lifting app. Default: no importer; onboarding collects working weights. Revisit if that app offers an export.
7. Wearable in use (Apple Watch, Garmin)? Default: manual entry now, file import in Phase 6.

## References

- free-exercise-db: https://github.com/yuhonas/free-exercise-db (Unlicense)
- Tailscale Serve: https://tailscale.com/kb/1312/serve
- The iOS PWA constraints in 3.4 were checked against 2026 developer write-ups. Re-verify against MDN compatibility tables and WebKit release notes before relying on any of them.
