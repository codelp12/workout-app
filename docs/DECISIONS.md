# Decisions

Newest first. Each entry gives the decision, why it was made, and the spec section it affects.

## 2026-11-10: Run logging (#57)

- **The run player is a form you fill in after the run**, under bars for the planned run. Each bar is one planned item, sized by distance and labelled with distance and target RPE. The Phase 1 stub plans one item per run, so you get one bar for now; warm-up, rep and cool-down bars come with the running engine (Phase 3). (§6.4)
- **The form has workout type, distance, minutes and seconds, RPE, and a collapsed "Heart rate, elevation and splits" section.** It prefills the planned workout type and distance. Pace is worked out as duration ÷ distance and shown as `m:ss /mi` (or `/km`) while you type, for the run and for each split. Distance uses the settings' distance unit. Elevation is in ft for mi and m for km. A run needs a distance, a duration and an RPE to save; heart rate, elevation, splits and notes are optional. Splits default to 1 unit each. (§4, §6.4)
- **Saving writes a finished `session_log`** (ended now, started the duration earlier, with the RPE and notes) and a `run_log`, both through the outbox, so it works offline and syncs when the device is back online. The planned run then reads as done, as it does for lifts (#55). A logged run shows a summary and can't be edited. (§3.1, §4)
- **The form isn't saved until you tap Save run.** It takes under a minute to fill in, so it isn't stored in `localStorage` like the lift player's position, and an iOS kill mid-entry loses the typed values.

## 2026-11-10: Finish a lifting session (#55)

- **"Finish workout" sits under the card once a set is logged** and opens a sheet with session RPE (1–10, required) and notes (optional). Finishing sets the `session_log`'s `endedAt`, `rpe` and `notes`, which go through the outbox like any other write, then syncs straight away. (§3.2, §4)
- **The client doesn't write `planned_session.status`.** The server owns plan rows (§3.1), so Today and Week show a planned session as done when its `session_log` has an `endedAt`. Week's done count already used finished logs. The server can write `done` itself later, and the client still shows it.
- **A finished session shows a summary in the player** (working sets, minutes, RPE, notes) instead of the cards, and isn't editable. Finishing clears the player's saved position and this device's active-workout pointer, so Today stops reopening it. History (#60) lists finished logs.

## 2026-11-10: Swap, skip, add set and warm-ups (#54)

- **Swaps and skips are `plan_override` rows, one per planned item** (`swapOverrideId(itemId)`, `skipOverrideId(itemId)`, UUIDv5s, in `apps/web/src/plan/item-overrides.ts`), so they go through the outbox and sync like moves, and the latest write wins on every device. A swap is kind `swap` with `{itemId, exerciseId}`; swapping back to the planned exercise deletes it. A skip uses the existing `trim` kind with `{itemId}`, rather than adding a new kind to `OVERRIDE_KINDS`; undoing it deletes the row. (§3.1, §4)
- **The swap list is the planned exercise's substitution group, dumbbell then band then bodyweight first, then by name**, using the engine's `equipmentRank` so the player and the engine agree on "equipment-first". Swap is offered only until the first set (warm-up or working) is logged, because logged sets belong to the exercise they were done on. (§5.1, §6.3)
- **A skipped card shows "Skipped." with Undo** and the player moves to the next card. Its sets stay hidden until it's unskipped.
- **Add set is device-local**: after the planned sets, "Add set" raises that card's target by one, kept with the player's position in `localStorage`. The extra set itself is an ordinary `set_log` that syncs; the plan isn't changed. (§3.1, §6.3)
- **Warm-ups ramp through about 40/60/80% of the first working load for 8/5/3 reps**, rounded to weights the equipment can make (or to the stepper's step for kettlebells and the like), dropping steps that round to nothing, the working load or the step before. They go on the first card of each movement pattern whose slot is `ramp` (the engine now copies `ramp` into the planned item's targets; older items count as `ramp`), and not on skipped cards. The rep counts are a guess; the spec only gives the percentages. (§5.1)
- **Warm-ups sit in a collapsed `<details>` and log with one tap each, as `set_log.isWarmup = true`.** They're numbered apart from working sets (`index` 0, 1, 2 within the warm-ups), don't start the rest timer, and stay out of "Set N of M", "Last time" and the engine's exposures, so working-set stats only see working sets. (§4, §5.1, §6.3)

## 2026-11-10: Rest timer and wake lock (#53)

- **The rest timer counts from the latest set's `completedAt`**, with that exercise's `restSec` (`latestRest()` in `apps/web/src/players/rest.ts`). The time left is recomputed from the clock every 250 ms and whenever the app returns to the foreground, so a locked screen, a backgrounded app or a kill can't put it out, and there's no timer state to save. It sits above the card, so it stays up when the player moves to the next exercise. (§3.4, §6.3)
- **At zero it turns orange and says "Rest over" with the overtime** (`+0:32`), and hides 10 minutes after the rest ran out. There's no skip or +30 s button yet; logging the next set restarts it. (§6.3)
- **The cue is two short beeps from Web Audio** (no sound file to cache), plus a buzz where the browser can vibrate (not iOS). It only plays if the rest ran out in the last 2 seconds with the app in the foreground, so coming back to the app after the rest ended, or reopening it after a kill, stays quiet and just shows "Rest over". iOS only starts audio from a tap, so Log set primes it; the silent switch mutes it. Nothing is scheduled for the background: iOS doesn't run timers or deliver web notifications reliably there. (§3.4)
- **The lift player holds a Screen Wake Lock while it's open and the session isn't finished** (`useWakeLock()` in `apps/web/src/players/use-wake-lock.ts`). The browser drops the lock whenever the app is hidden, so it's requested again on return; leaving the player or finishing the session (`endedAt`, #55) releases it. Where the API is missing or refuses (e.g. low-power mode), the screen locks as usual. Run and climb players (#57, #58) can reuse the hook. (§3.4)

## 2026-11-10: CI runs in the Playwright image

- **The `Lint, test and build` job runs inside `mcr.microsoft.com/playwright:v1.64.1-noble`** instead of running `playwright install --with-deps` on the bare runner. The apt step pulled 139 MB of browser libraries from the runner's Ubuntu mirror. On a slow mirror (161 kB/s) that took 10–18 minutes and once hit the 20-minute timeout, while the same step sometimes took 38 seconds. The image ships Chromium, WebKit and their libraries, so E2E has nothing to install. It runs as the runner's user (`--user 1001`) so checkout and caches can write to the workspace, with `--ipc=host` as Playwright recommends for Chromium. The image's tag has to equal `@playwright/test` in `pnpm-lock.yaml`. If they drift, E2E fails with Playwright's "Executable doesn't exist" error, so bump both together. (§10)
- **Job timeout lowered from 20 to 10 minutes.** The job takes a couple of minutes now, so a hang fails sooner. (§10)

## 2026-11-10: Load picker (#52)

- **The weight is a picker, not a typed number** (`LoadPicker` in `apps/web/src/components/`). − and + step to the next lighter or heavier load the equipment can make, and tapping the weight opens a sheet listing them all. There's no text field, so an unloadable weight can't be shown or logged. (§5.1, §6.3)
- **What's offered** (`loadChoices()` in `apps/web/src/players/lift-log.ts`, built on the engine's `availableLoads`/`roundToLoadable`): the dumbbell rack; fixed barbells plus everything the optional bar and plates make; for cable or machine, stack steps (the first 50, or 10 past the current load if that's further, since a stack has no top). Band exercises get a chip row of the inventory's bands. Kettlebells and other implements the inventory doesn't model keep the plain stepper. (§2, §6.3)
- **Prefills and saved drafts snap to the nearest load on offer** (the lighter on a tie, like the engine), so a target, the previous set or a resumed draft never shows a weight the equipment no longer makes after an equipment edit. A band that's gone falls back to the lightest, which is also the default for a band exercise with no history. (§5.0, §5.1)
- **If the equipment has none of the implement** (e.g. dumbbells turned off), the card says so with a link to Settings and Log set stays disabled rather than logging a made-up weight. (§5.1)

## 2026-11-10: Lift player core (#51)

- **One `session_log` per planned session** (`sessionLogId(plannedSessionId)`, a UUIDv5), created when the first set is logged, so just opening a session writes nothing. Logging the same session on two devices fills one log instead of making two. `endedAt` stays null until finishing lands (#55). (§3.2, §4)
- **Every set is its own `set_log` write through the outbox** the moment it's logged (`logSet()` in `apps/web/src/players/lift-log.ts`), so a kill loses nothing logged. The card on screen and any unlogged stepper values are kept in `localStorage` per session (device-local, like the onboarding flag), so the player reopens exactly where it was. (§3.1)
- **A killed PWA reopens on Today, so launching on Today opens the lift session this device was logging** if its log is still open from today, after the first-run wizard check. It's device-local (`localStorage`), so a workout on the phone never takes over the laptop, and deep links aren't redirected. (§3.1, §3.4)
- **Two taps per set: pick RIR, then Log set.** Weight and reps are prefilled, from the target for the first set (the top of the rep range) and from the previous set after that. RIR starts unpicked whenever the slot has a target RIR, so every logged working set has an honest RIR for the engine. Slots without one (e.g. planks) log in one tap. Logging the last planned set moves to the next exercise. (§1, §5.1, §6.3)
- **Cards swipe with a plain pointer gesture** (60 px) as well as Previous/Next buttons, with no carousel library. The weight stepper steps by the rack's dumbbell step (or the stack step), until the load picker (#52) offers only available weights. Bodyweight and band slots log no load. "Last time" lists the working sets from the latest earlier log of the exercise. "How to" links to the exercise's Library page for now. (§2, §6.3)

## 2026-11-10: Week view (#49)

- **A move is a `plan_override` row of kind `move`, one per session** (`moveOverrideId(sessionId)`, a UUIDv5), with `data: { date, slot }`. Moving a session again updates the same row, so last-write-wins settles two devices moving it at once; moving it back to where the plan put it deletes the override. The row records the outbox op that wrote it (`opId`). Plan rows stay server-owned and untouched. (§3.1, §3.2, §4)
- **Screens apply the moves when they read the plan** (`latestMoves()` and `placeSession()` in `apps/web/src/plan/moves.ts`), so Today, the session screen and Week all show a moved session on its new day, offline and on every synced device. The server stores overrides as plain rows for now; validating them and regenerating the plan around them comes with the Phase 5 scheduler, as #27 noted. (§3.2, §5.4)
- **Moving is tap-to-move, not drag.** Tapping a session opens a sheet with day and AM/PM chips, Move and Put back. Drag-and-drop on a phone needs a library outside §2 (e.g. dnd-kit), so it waits for the owner's sign-off. Moves stay inside the shown week; done and skipped sessions can't be moved (§5.4 pins completed sessions). Any slot is allowed: the constraint warnings come with the scheduler. (§5.4, §6.2)
- **The grid is the current week, one row per day with AM and PM columns**, color-coded by modality, with today highlighted. Filters (All, Lifting, Running, Climbing) live in the URL (`/week?show=run`) like the Library's. (§6.2)
- **The last-week vs this-week strip counts sessions done of planned per modality.** "Done" is a finished `session_log` (`endedAt` set) on the week's dates, so it fills in once the players write logs (#51, #57, #58). Volume comparisons (sets, miles, problems) belong to the Progress screen. (§6.2, §6.6)

## 2026-11-09: Today view (#48)

- **Today reads the plan straight from IndexedDB** (`dayPlan()` in `apps/web/src/plan/sessions.ts`), so it works offline and shows the provisional week until the server's arrives. "Today" is the date in the settings' time zone, rechecked every minute and when the app returns to the foreground. Sessions are grouped AM and PM; ones marked `moved` are left out, and done or skipped ones show their status instead of Start. A deload week is labelled. (§3.2, §6.1)
- **Each card shows a one-line target summary from the planned items**: exercises and sets for lifts, distance and RPE for runs, grades and problem count for climbs. Lift titles come from the template, others from the workout type ("Easy run", "Limit climb"). (§6.1)
- **Start opens `/session/<plannedSessionId>`, which picks the player by modality** (`apps/web/src/players/`). Until #51, #57 and #58 land, each player lists the planned targets and writes nothing; starting a session log is the players' job. (§6.3–6.5)
- **The coach note is a placeholder card** until the engines write one (Phases 2–4), and the sync chip stays in the shared header shown on every tab. The readiness check-in waits for Phase 5. (§5.5, §6.1)

## 2026-11-02: Global calendar and weekly rollover (#47)

- **The server runs the rollover at the start of every pull** (`planCurrentWeek()`): if the week that's current in the owner's zone has no row, it plans it from every log it has. Pushes then pulls, so the first sync after Sunday midnight gets the new week. It uses the settings' `timezone`, or the server's own zone until settings first sync. (§3.2)
- **Plan rows have ids derived from the week** (`weekId(start)`, `blockId(start)`, `plannedSessionId(weekStart, key)`, `plannedItemId(session, position)`). Repeated or concurrent syncs can't make a second copy, and the phone's provisional week is the same rows as the server's, so a pull overwrites them. After a pull the phone drops any provisional rows the server's week didn't replace (`dropReplacedProvisional()`). (§3.2)
- **The phone plans a provisional week** (`planProvisionalWeek()`) on launch and when it comes back to the foreground, if it has no row for the current week. The rows have `serverSeq` 0 and never enter the outbox, since plan rows are server-owned. (§3.1, §3.2)
- **One pure planner for both** (`planWeek()` in `packages/engine`), from the stubs. Blocks default to 4 weeks, the last a deload (`config.calendar.blockWeeks`); a week outside every live block starts a new one. Week-type effects on targets arrive with the engines. (§5.1, §5.4)
- **A fixed default week until the Phase 5 scheduler** (`DEFAULT_WEEK`): Mon Legs A (PM); Tue Push A (AM) and volume climb (PM); Wed quality run (AM) and Pull A (PM); Thu easy run (AM) and Legs B (PM); Fri Push B (AM) and limit climb (PM); Sat long run (AM), lift-free; Sun Pull B (AM). It meets the hard constraints and avoids every high soft penalty. The quality run alternates threshold and intervals by week. A session whose slot is unavailable moves to the day's other slot if that one is free; `longRunDay` and `liftFreeDay` wait for the scheduler. Lift sessions whose default template was deleted are planned without exercises. (§5.4)
- **Planned item targets are the stub's prescription** minus its reasons, which become the item's `reasons` text. (§4, §5.0)

## 2026-11-02: Default templates and the template editor (#46)

- **The server seeds the six default templates at startup** (`seedTemplates()` after `seedExercises()`), so they reach every device through the normal pull, like the library. Ids are UUIDv5 of `default-template:<key>` (`defaultTemplateId()`), so every server seeds the same rows. Like the library, it never updates or undeletes an existing row, so edits and deletions survive restarts. (§3.1, §4)
- **The templates are a table in `packages/exercise-data/src/templates.ts`** (`DEFAULT_TEMPLATES`), and `DEFAULT_TEMPLATE_EXERCISES` is now derived from it. Main lifts get 3 × 6–10 (A days) or 3 × 8–12 (B days) with 150–180 s rest; accessories 2–3 × 10–20 with 60–90 s. Target RIR is 2 (1 for small isolation moves). The first two slots are `ramp` (§5.1 default). A days are heavy and B days moderate; Legs A is the only key lifting session ("heavy legs", §5.4), and the rest are support. Plank holds use the rep range as seconds (30–60) until sets can be timed. (§4, §5.1, §5.4)
- **The editor lives under Settings** (Settings → Lifting templates → `/settings/templates/<id>`), since there's no Plan tab yet (§6.9); the Settings tab stays highlighted there. It edits name, intensity, intent and each slot's sets, rep range, RIR (0–4), rest, ramp and order; exercises are added from a search of the lifting library. Every change saves at once through the outbox, like Settings. (§6)

## 2026-11-02: Engine interface and static stubs (#45)

- **`ModalityEngine<State, Intent, Prescription, Log>`** in `packages/engine/src/types.ts` has `initState(onboarding)`, `prescribe(state, intent, ctx)`, `update(state, log)` and `reviewWeek(state, logs, ctx)`, plus `modality` and `version` (`stub-1`, for `generatedBy: engine@<version>`). `EngineContext` carries everything outside the engine's state: the session's local date (the engine never reads the clock), week type, readiness (green until Phase 5), units, equipment and config. Each modality has its own intent, prescription and log types; logs are the shared row types trimmed with `Pick`, so the engine doesn't depend on Dexie or the server. (§5.0)
- **Reasons are `{ code, text }`**: a stable code (`from_setup`, `repeat_last`, `rounded`, `no_history` …) and one plain-English line. Every prescription and every lift item has at least one (property-tested). (§5.0)
- **The stubs prefill but never progress.** Lift: the template's sets, reps and RIR as written, with the load from the top working set of the last session, or else the onboarding answer, converted to the current unit and rounded to the rack; group-only slots pick the dumbbell, then band, then bodyweight option. Run: last time's distance for the same workout type, or else a share of the onboarding weekly distance (long 40%, easy and quality 30%), with a target RPE and no paces until VDOT lands. Climb: limit sessions at limit−1 to limit+1 with a 12-attempt cap, volume sessions at volume−2 to volume−1, from the onboarding grades. (§5.1–5.3)
- **Thresholds live in `ENGINE_CONFIG`** (`config.ts`) and reach the engines through the context, so per-user overrides from `settings.engineConfig` can be merged in later without touching the engines. Grade scales moved to `GRADE_SCALES` in the engine, and onboarding uses them. (§5.0, §5.3)

## 2026-11-02: Onboarding wizard (#43)

- **Onboarding answers are stored on the settings row as `onboarding`** (migration `0006_settings_onboarding`, nullable JSON), kept as entered: per main lift a recent working set (load per dumbbell, reps, RIR), one recent hard run (distance, time, RPE) plus typical weekly distance, and climbing discipline with limit and volume grades. Any part can be left out. The engines (Phases 2–4) turn these into their starting `fitness_state`; storing them on settings needs no new synced table before those engines exist. (§4, §5.0, §12 Q3–Q5)
- **The main lifts are `MAIN_LIFTS` in `packages/shared`**: dumbbell squat, bench press, RDL (stiff-legged dumbbell deadlift), seated overhead press and one-arm row, the §5.1 `e1rm_rir` compounds from the default templates (a test checks each is in one). Entered weights snap to the nearest dumbbell on the rack with `roundToLoadable`. (§5.1)
- **The wizard opens once per install, when the app starts on Today and the settings have no answers.** Finishing saves the answers (and they sync); "Skip for now" saves nothing. Either way a device-local flag (`localStorage`) stops it opening again on that device, so a second phone still gets the wizard until its first sync brings the answers. Deep links never redirect. Settings has "Start setup" / "Run setup again", which reopens it prefilled. (§5.0)
- **Step 1 is the same equipment editor as Settings**, so equipment changes save immediately; the later steps save together on Finish. E2E tests start with the device flag set (`storageState` in `e2e/playwright.config.ts`) so only `onboarding.spec.ts` sees the wizard. (§6)

## 2026-11-02: App updates move to Settings

- **The floating "Update available" bar is gone; updates live in Settings → App updates** (owner's request: the bar sat behind the tab bar on an iPhone 16 Pro Max and got in the way). **Check for updates** calls the service worker registration's `update()`, and **Reload to update** is disabled until a new build has installed and is waiting. A small dot on the Settings tab (with "update available" for screen readers) says one is ready. `registerType: "prompt"` stays, so nothing reloads without a tap. (§8)

## 2026-11-02: Settings screen (#42)

- **Settings are one row with a fixed id** (`SETTINGS_ID` in `packages/shared`), so every device edits the same row and last-write-wins keeps a single copy. Until something is changed the screen shows `defaultSettings()` (SPEC §2: lb and miles, the default inventory, every day AM and PM with gym access, the planner choosing the lift-free and long-run days, this device's time zone) and saves nothing. (§3.2, §4)
- **Every change saves at once** through the outbox, with no Save button, so settings work offline like any other write. Updates run one at a time against the latest saved row, so quick taps don't overwrite each other. A device that changes settings before its first sync overwrites the server's copy; with one owner that's acceptable. (§3.2)
- **Switching the weight unit doesn't convert the equipment**; the screen says so. The inventory is entered in the owner's unit, and converting a 5 lb rack to kg would give weights no rack has. (§2, §4)
- **The screen edits dumbbells (on/off, lightest, heaviest, step), fixed barbells, bands (lightest first, reorderable), weekly availability (AM, PM and gym per weekday), and the lift-free and long-run days.** The optional loadable bar, plates and machine stack stay in the data model with no editor yet; they come when a gym-day template needs them. Export, backup status and the engine config viewer are later epics. (§4, §6.10)

## 2026-11-02: Loadable weights and the engine package (#41)

- **`packages/engine` starts here**, pure TypeScript with no runtime dependencies beyond `@workout-app/shared` types. ESLint bans `Date`, `fetch`, timers, `Math.random`, `node:` and other I/O imports in its source, so "no I/O, no clock reads, no randomness" is checked on every lint, not just by review. fast-check (named in §5.6) is its dev dependency for property tests. (§2, §5.0, §5.6)
- **`roundToLoadable(equipment, implement, target, rounding)`** rounds to a load the inventory can make on a dumbbell (per hand), fixed barbell, loadable bar (bar plus plate pairs) or stack; `availableLoads` lists them for the load picker and `isLoadable` checks one. `nearest` breaks ties toward the lighter load (slow to increase, §5.0); `down` and `up` never cross the target and return `null` when nothing is on that side, so the engine can tell "the next step doesn't exist" and progress reps instead (§5.1). Weights are compared in thousandths, so fractional plates and steps (2.5 lb, 1.25 kg) don't drift. Bands are levels, not weights: `roundBandLevel` rounds to a band index, lightest first. (§5.1)
- **The default inventory is `DEFAULT_EQUIPMENT` in `packages/shared`**, so Settings (#42) and onboarding (#43) start from the same values the engine is tested against: dumbbells 5–120 lb in 5 lb steps, fixed barbells 20–110 lb in 10 lb steps, and four bands (Light, Medium, Heavy, Extra heavy). SPEC §2 gives the step but not the barbell range or band names, so those are guesses for the owner to correct in Settings. No loadable bar, plates or stack by default. (§2)

## 2026-11-01: Library screen (#39)

- **Personal notes are a nullable `notes` field on the `exercise` row** (migration `0005_exercise_notes`), saved through the normal outbox and synced like any edit. Seeding never overwrites an existing row (#38), so notes survive restarts and dataset bumps. Personal cues, photos and clips (§7) come later and get their own fields. (§4, §6.8)
- **Search and filters run on the device over the IndexedDB copy**, so they work offline. Search matches every typed word as a word prefix of the name or an alias (`db press` finds "Dumbbell Bench Press"). Filters are muscle (primary muscles only, so "Chest" means chest exercises), equipment and movement pattern; within a filter any chosen value matches, across filters all must. Filter options come from the exercises on the device, not a fixed list. (§6.8)
- **The search and filters live in the URL** (`/library?q=press&muscle=chest`), so Back from an exercise restores them. An exercise's page is `/library/<id>`, and the Library tab stays highlighted there. (§6)
- **Cues and common mistakes only show when an exercise has some**; the dataset has none yet. Exercise history on the detail page waits for logging (Phase 1 lift player). (§6.8)

## 2026-11-01: Images for every exercise (#38 follow-up)

- **Every imported exercise's images are converted and committed, not just the core set's** (owner's choice over fetching them from GitHub on demand or leaving them out). `pnpm --filter @workout-app/exercise-data images` now writes core images to `packages/exercise-data/media/core/` and the other 1414 to `media/other/`, same 480 px WebP at quality 75. The other set is 18 MB (13 KB average, 39 KB max), which grows the repo and Docker image by that much but keeps the server off the network. (§7)
- **The split keeps the pre-cache to the core set.** The service worker pre-caches only `media/core/` (still under the 5 MB budget); other images are cached when first viewed (#38's `CacheFirst` rule). The server serves both folders at the same `/media/exercises/<media path>`, so media paths don't say which set an image is in. Tests check each folder holds exactly its set's images and that every image is a WebP within the 40 KB per-image limit. (§7)

## 2026-11-01: Seeding the library and caching it offline (#38)

- **The server seeds the library at startup.** `seedExercises()` (`apps/server/src/seed.ts`) runs after migrations and inserts every free-exercise-db exercise the database doesn't have yet, each with a new `serverSeq`, so devices get them through the normal pull and a fresh install has the library after its first sync. It never updates or undeletes an existing row, so edits and deletions survive restarts. A future dataset bump only adds new exercises; changing existing ones would need its own migration. (§3.1, §7)
- **Library ids are UUIDv5 of `free-exercise-db:<sourceId>`** (`libraryExerciseId()` in `packages/shared`), so they're the same on every server and device, and templates (#46) can refer to an exercise before any sync. The namespace is fixed in code; changing it would re-key every exercise. (§4)
- **The server serves exercise images at `/media/exercises/<media path>`** straight from `packages/exercise-data/media/`, without a session (they're Unlicense dataset photos, like the app shell), with a one-day `Cache-Control`. Missing files are a 404, never the app shell. The server stays offline-capable: it never fetches images itself. (§7)
- **The service worker pre-caches all 304 core images** (3.5 MB) through `additionalManifestEntries` in `apps/web/vite.config.ts`, revisioned by content hash, so they're there in airplane mode from the first visit. Any other `/media/` image is cached the first time it loads (`CacheFirst`, at most 1000 entries). Non-core exercises have no image files yet. (§7)

## 2026-11-01: Core exercise set and images (#37)

- **The core set is a hand-picked list of 152 free-exercise-db ids** in `packages/exercise-data/src/core.ts`: the default templates' exercises, then dumbbell, band, bodyweight and kettlebell substitutes for each pattern (a few barbell, EZ-bar and cable ones for gym days), core work, and 24 mobility entries for warm-ups and cool-downs. 120 of the 152 are tagged dumbbell, band, bodyweight or kettlebell (most stretches have no equipment tag). Tests check every id exists and the count stays near 150. Climbing-specific exercises (hangboard, etc.) aren't in free-exercise-db and come with the climbing epics. (§5.1, §7)
- **The default templates' exercises are chosen here** (`DEFAULT_TEMPLATE_EXERCISES`), so "covers every default template exercise" is testable before #46 adds sets, reps, RIR and rest. Push/Pull/Legs A and B, six exercises each, all dumbbell or bodyweight apart from a band pull-apart and the goblet squat (tagged kettlebell upstream, done with a dumbbell). #46 builds the templates from this list. (§5.1)
- **Images are 480 px wide WebP at quality 75, committed under `packages/exercise-data/media/`.** `pnpm --filter @workout-app/exercise-data images` (sharp, owner-approved dev dependency) downloads each core image from the pinned commit, converts it and deletes images no longer in the set. Committing the output means builds, CI and Docker never need the network or sharp. Upstream JPEGs average 55 KB at 850 px. (§7)
- **Size budget: 40 KB per image and 5 MB for the whole core set** (`CORE_IMAGE_BUDGET`), enforced by tests. The set is pre-cached on the phone (#38), so it has to stay well under iOS's storage eviction risk. Today it's 304 images, 3.5 MB in total, 12 KB on average and 34 KB at most. (§7)
- **Every exercise's media path now points at the WebP** (`Dumbbell_Bench_Press/0.webp`, relative to the media root), including non-core ones, which have no file yet. How the server serves those on demand is #38's call. (§7)

## 2026-11-01: free-exercise-db import (#36)

- **The dataset is vendored, pinned and hash-checked.** `packages/exercise-data/data/free-exercise-db/` holds upstream's `dist/exercises.json` and `LICENSE.md` from commit `f00c92c` (2026-09-27), exactly as published; `source.json` records the commit and each file's SHA-256. `pnpm --filter @workout-app/exercise-data dataset` re-downloads that commit and fails if a byte differs, and a test checks the vendored files against the hashes. The script only runs at dev time; the app never fetches from GitHub. Prettier skips the folder so the bytes stay upstream's. (§7)
- **Mapping happens in code, not in a generated file.** `loadFreeExerciseDb()` validates the vendored JSON against upstream's schema (zod) and maps each entry with `mapExercise()`, so a mapping change is a reviewable code diff and there is no second 1 MB file to keep in sync. The package is Node-only (it reads the file with `fs`); clients get exercises through sync (#38). (§4, §7)
- **Cardio entries (14: treadmill, bikes, rowers, stair machines) aren't imported.** Runs are `run_log`s with their own workout content (§7), and cardio machines aren't in the plan. Everything else, 862 exercises, is imported; curating the ~150 core ones is #37. (§4, §7)
- **Derived fields use simple, tested rules.** Upstream has no aliases, movement patterns, stress tags or substitution groups:
  - `movementPattern`: one of `MOVEMENT_PATTERNS` (squat, lunge, hinge, horizontal/vertical push and pull, carry, olympic, jump, curl, triceps_extension, raise, fly, leg_extension, leg_curl, calf_raise, shrug, core, stretch), from name keywords, category and primary muscle, first match wins. About 10% of lifts (odd strongman and rotation moves) get none.
  - `stressTags`: the pattern's regions plus each primary muscle's region (quads → knee, forearms → wrist, …), in `STRESS_TAGS` order.
  - `substitutionGroup`: `<pattern>:<first primary muscle>`, e.g. `horizontal_push:chest`, falling back to the mechanic (`compound:quadriceps`).
  - `progressionModel`: `e1rm_rir` for compound main patterns with free weights (barbell, dumbbell, kettlebell, EZ bar), else `double_progression` with an 8–12 rep range; none for stretches. `increment` stays null, meaning the equipment's default step (§5.1).
  - `aliases`: abbreviations people type (DB, BB, KB, RDL, OHP). `unilateral` from names like one-arm, single-leg, lunge and split squat. `cues` and `commonMistakes` start empty.
    (§4, §5.1, §5.5)
- **Vocabulary is snake_case:** muscles as upstream names them (`lower back` → `lower_back`) and equipment as `EQUIPMENT` (`body only` → `bodyweight`, `e-z curl bar` → `ez_bar`). (§4)
- **Every exercise and every image carries `source: free-exercise-db@<commit>` and `license: Unlicense`**, plus `sourceId` (upstream's id). Image `path`s are upstream's (`3_4_Sit-Up/0.jpg`) until the image pipeline (#37) converts them to WebP. (§7)

## 2026-11-01: Navigation shell (#34)

- **React Router in declarative ("library") mode** (`react-router`, owner-approved on the roadmap): `BrowserRouter` in `main.tsx` and `<Routes>` in `src/Navigation.tsx`. Data mode's loaders and actions aren't needed, since screens read Dexie through live queries and never wait on the network. (§2, §6)
- **Five tabs with real URLs:** Today `/`, Week `/week`, Log `/log`, Library `/library`, Settings `/settings`. Any other path redirects to Today. Deep links work offline because the service worker already answers every navigation with `index.html` (`navigateFallback`), and online the server's SPA fallback does the same. (§6, §8)
- **The tab bar is fixed to the bottom**, inside a `Tabs` navigation landmark and outside `main`, sized to `min-h-tap` and padded for the home indicator, with each tab shown as an icon plus a label. The icons are inline SVG, so no icon library. The current tab is marked with `aria-current="page"` and the accent color, each screen has its own `h1` and document title, and switching tabs scrolls to the top. (§6)
- **The app header (sync chip, unsynced warning, sign-in) appears on every tab.** A sync 401 has to be able to ask for the password anywhere. The Projects placeholder stays on Today, and "Import unsynced data" moves to Settings until #42 builds that screen. (§3.2, §3.4)

## 2026-11-01: Accessible base components (#33)

- **Radix primitives, one package each:** `@radix-ui/react-dialog` (bottom sheet), `@radix-ui/react-toggle-group` (chip group) and `@radix-ui/react-toast` (toast), rather than the `radix-ui` bundle of every primitive. They bring focus trapping, roving focus, live-region announcements and Escape handling that we'd otherwise hand-roll. Styled with the #32 theme tokens; no shadcn copy-in or class-merging library. (§2, §6)
- **The stepper and skeleton are our own.** Radix has no number-field or skeleton primitive. The stepper's number is an ARIA `spinbutton` (arrow keys step, Home/End jump to the limits, a typed value commits on Enter or blur and is clamped, not snapped to the step); its − and + buttons are named after the label ("Increase Weight"). A skeleton is `aria-hidden`; `Loading` wraps a screen's skeletons and announces one label. (§6)
- **Single-select chips can't be cleared by tapping again.** Radix clears a single toggle group when the selected item is pressed; for pickers like RIR or grade that's an accidental tap, so it's ignored. Selected chips use the accent color, or the modality's color (`selected` in `src/modality.ts`). (§6)
- **Toasts sit at the top** of the screen, clear of the thumb, the bottom tabs (#34) and sheets, and are swiped up to dismiss. They last 5 s by default and take at most one action (e.g. Undo), with `altText` for screen readers. `ToastProvider` wraps the app in `main.tsx`; screens call `useToast()`.
- **Component tests run in jsdom with Testing Library** (dev dependencies `jsdom`, `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event`). Only files with a `// @vitest-environment jsdom` docblock use it; the rest stay in Node. Tests query by role and name, so they check what a screen reader gets.

## 2026-11-01: Tailwind and dark theme (#32)

- **Tailwind CSS v4 through `@tailwindcss/vite`** (dev dependencies `tailwindcss` and `@tailwindcss/vite`, SPEC §2). v4 is configured in CSS, so there is no `tailwind.config.js` or PostCSS setup; its native engine ships as prebuilt platform packages and needs no `allowBuilds` entry. (§2)
- **All theme tokens live in the `@theme` block of `apps/web/src/index.css`:** surfaces (`bg`, `surface`, `surface-raised`, `border`), text (`fg`, `fg-muted`), `accent`, `danger`, `warning`, one color per modality and `--spacing-tap`. Components use only these tokens (`bg-surface`, `text-climb`, `min-h-tap`), not Tailwind's palette. `bg` (`#111827`) is also the `theme-color` in `index.html` and the manifest colors; `theme.test.ts` keeps them equal. (§6)
- **Modality colors:** lifting orange (`#fb923c`), running sky blue (`#38bdf8`), climbing green (`#4ade80`), mobility violet (`#c084fc`). `src/modality.ts` maps each modality to its label and class names, so screens pick a modality's color from one place and a new modality fails typecheck until it has one. (§6)
- **Dark only for now.** `color-scheme: dark` and no light theme or toggle; the spec says dark by default and nothing needs light yet. (§6)
- **Tap targets are at least 48 px** (`--spacing-tap: 3rem`), above Apple's 44 pt minimum, for use mid-set with chalky or sweaty hands. The base layer applies it to every button and form control. (§6)
- **Tabular numerals app-wide** (`font-variant-numeric: tabular-nums` on `body`), with the system font stack, so nothing is downloaded and weights and paces line up. (§6)

## 2026-11-01: Unsynced-data safety net (#30)

- **"N unsynced sessions" counts distinct training sessions** with a queued or rejected write: a `session_log` op, or a `set_log`, `run_log` or `ascent` op whose `sessionLogId` points at it. Until the logging screens exist, other queued writes (like Projects) show as "N unsynced changes", and rejected ops get their own count. The warning is hidden while a sync is running, so an ordinary online write doesn't flash it. (§3.4)
- **The export file is the push format.** `{ format: "workout-app/unsynced", version: 1, exportedAt, ops, rejected }`, where `ops` are the outbox's ops, oldest first, with their original `opId`s; the envelope's schema is `unsyncedExportSchema` in `packages/shared`. Since the server dedupes on `opId`, importing a file whose ops already synced (from this or another device) changes nothing. Rejected ops are in the file for reference only, since sending them again would fail the same way. (§3.2, §3.4)
- **Import is in the web app, not a server endpoint.** "Import unsynced data" queues the file's ops in that device's outbox and syncs, so it works offline, uses the normal session and batching, and needs no new route. It writes a row locally only when the device doesn't have it, since an existing row may be newer than the file. The control sits at the bottom of the page until the Settings screen (#42) gives it a home.
- **The download is a plain `<a download>` of a JSON blob.** No Web Share API for now; whether iOS saves it to Files from the installed app is a step in `docs/IPHONE-CHECKLIST.md`.

## 2026-10-31: Client sync engine (#28)

- **One Dexie database, `workout-app`, mirrors every synced table** under its entity name, plus `outbox`, `rejected` and `meta` (the pull cursor). A write puts the row and its outbox op in one transaction and returns; sync runs in the background afterwards, so logging never waits on the network. A new row has `serverSeq: 0` until it comes back from a pull. (§3.1)
- **A sync pushes the whole outbox, oldest first, then pulls from the stored cursor until `hasMore` is false.** An op leaves the outbox only once the server answers `applied` or `duplicate`. Offline, a 401 or a server error stops the run and leaves the outbox untouched. Overlapping triggers share one run, plus one follow-up. (§3.2)
- **Rejected ops move to a `rejected` table** instead of being dropped or retried forever. Retrying can't succeed and would show "pending" indefinitely; keeping them means #30 can export them.
- **A pull doesn't overwrite a row that still has a queued op.** The queued write reaches the server later, wins there, and comes back in a later pull.
- **Triggers:** app open, returning to the foreground, the `online` event, after every local write, after sign-in, and tapping the status chip. `syncSoon()` is the hook for workout completion (#55). (§3.2)
- **Status chip:** `Synced`, `N pending`, `Offline`, `Sign in to sync` and `Sync failed`, with the pending count added when offline or signed out. A sync 401 also shows the sign-in form. (§3.2)
- **The spike is gone.** `/api/spike`, the `spike_note` table (migration `0004`) and the `workout-app-spike` IndexedDB store are deleted; their notes were test data. A placeholder climbing **Projects** list exercises sync in the UI and the E2E until the real screens land (#58).
- **`fake-indexeddb` (dev only)** runs Dexie in the web package's Vitest tests.

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

## 2026-10-31: Sync endpoints (#27)

- **Ops carry whole rows.** An `upsert` sends the full row except `userId` and `serverSeq`, which the server fills in. A `delete` sends `{id, deletedAt}`. Last-write-wins per record replaces the whole row anyway, so field-level patches would add complexity for nothing. The first write's `createdAt` is kept. (§3.2)
- **One global `sync_counter`.** Every accepted write takes the next number from a single counter, so the pull cursor is one integer across every table and pages never skip or repeat a row. `MAX(server_seq)` across tables would avoid the table, but purging old tombstones later could hand out a number twice. (§3.2)
- **Bad ops are rejected one at a time.** An invalid op gets `rejected` with the error and no receipt, and the rest of the batch still applies, so one bad op can't block the outbox behind it. The client sync engine (#28) decides what to do with rejected ops. Only a malformed envelope (no ops, a bad `opId`, more than 500 ops) fails the whole request. (§3.2)
- **Deletes follow last-write-wins too.** A later upsert of a tombstoned row brings it back, as §3.2 says. A delete of a row the server never had is applied as a no-op.
- **The push response's cursor is informational.** It's the server's latest `serverSeq`. Clients keep pulling from their own cursor, since jumping to it would skip other clients' writes.
- **Not done yet: engine re-runs and plan ownership.** §3.2 has push re-run the engine and validate `plan_override` ops, and treats plan rows as server-owned. There's no engine yet, so for now every entity is accepted as a plain row. Enforcing plan ownership comes with the engine epics. (§3.1, §3.2)
- **The server now imports `@workout-app/shared` at runtime**, not just its types. `pnpm deploy` already copies the package's `dist`, so the Docker image needs no change.
