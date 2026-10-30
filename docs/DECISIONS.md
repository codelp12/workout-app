# Decisions

Newest first. Each entry gives the decision, why it was made, and the spec section it affects.

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
