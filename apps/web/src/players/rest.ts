import type { LiftCard } from "./lift-log";

/** The rest after the latest set logged this session. */
export type Rest = { endsAt: number; restSec: number };

/** How long the "Rest over" banner stays up before the timer hides. */
export const REST_OVERTIME_SHOWN_MS = 10 * 60_000;

/**
 * The rest owed after the session's latest set, from its `completedAt`, so
 * it's right after a screen lock or a kill (SPEC §3.4). Null before the first
 * set and when that exercise has no rest.
 */
export function latestRest(cards: LiftCard[]): Rest | null {
  let latest: { completedAt: number; restSec: number } | null = null;
  for (const card of cards) {
    for (const { completedAt } of card.sets) {
      if (completedAt === null) continue;
      if (!latest || completedAt > latest.completedAt) {
        latest = { completedAt, restSec: card.targets.restSec };
      }
    }
  }
  if (!latest || latest.restSec <= 0) return null;
  return {
    endsAt: latest.completedAt + latest.restSec * 1000,
    restSec: latest.restSec,
  };
}

/** Whole seconds of rest left, rounded up; zero or less once it's over. */
export const secondsLeft = (rest: Rest, now: number) =>
  Math.ceil((rest.endsAt - now) / 1000);

/** `2:05` */
export const formatClock = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
