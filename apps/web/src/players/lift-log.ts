import { type WeightImplement } from "@workout-app/engine";
import {
  localDateAt,
  newId,
  sessionLogId,
  type Exercise,
  type SessionLog,
  type Settings,
  type SetLog,
  type WeightUnit,
} from "@workout-app/shared";
import type { LiftTargets, SessionView } from "../plan/sessions";
import type { LocalDb } from "../sync/local-db";
import { saveRow } from "../sync/writes";

/** What the owner has dialled in for the next set. */
export type SetValues = {
  /** Null for bodyweight and band sets. */
  load: number | null;
  reps: number;
  rir: number | null;
};

/** One exercise of the session, as the player shows it. */
export type LiftCard = {
  itemId: string;
  exercise: Exercise | null;
  targets: LiftTargets;
  /** This session's sets of the exercise, in order. */
  sets: SetLog[];
  /** The working sets of the latest earlier session with this exercise. */
  lastTime: SetLog[];
};

export type LiftSession = { log: SessionLog | null; cards: LiftCard[] };

type PlayerSettings = Pick<Settings, "weightUnit" | "timezone" | "equipment">;

const live = <T extends { deletedAt: number | null }>(rows: T[]) =>
  rows.filter((r) => r.deletedAt === null);

/** The session's exercises with what's been logged so far and last time. */
export async function readLiftSession(
  db: LocalDb,
  view: SessionView,
): Promise<LiftSession> {
  const items = view.items.filter((i) => i.kind === "exercise");
  const ids = new Set(
    items.flatMap((i) => (i.exerciseId ? [i.exerciseId] : [])),
  );
  const logId = sessionLogId(view.session.id);
  const log = (await db.rows("session_log").get(logId)) ?? null;
  const sets = live(await db.rows("set_log").toArray()).filter((s) =>
    ids.has(s.exerciseId),
  );
  const logs = new Map(
    live(await db.rows("session_log").toArray()).map((l) => [l.id, l]),
  );
  const exercises = await db.rows("exercise").bulkGet([...ids]);
  const byId = new Map(exercises.flatMap((e) => (e ? [[e.id, e]] : [])));

  const lastTime = (exerciseId: string) => {
    const earlier = sets.filter(
      (s) =>
        s.sessionLogId !== logId && logs.has(s.sessionLogId) && !s.isWarmup,
    );
    const latest = earlier
      .filter((s) => s.exerciseId === exerciseId)
      .map((s) => logs.get(s.sessionLogId)!)
      .sort(
        (a, b) =>
          b.localDate.localeCompare(a.localDate) || b.startedAt - a.startedAt,
      )[0];
    return latest
      ? earlier
          .filter(
            (s) => s.sessionLogId === latest.id && s.exerciseId === exerciseId,
          )
          .sort((a, b) => a.index - b.index)
      : [];
  };

  return {
    log: log && log.deletedAt === null ? log : null,
    cards: items.map((item) => ({
      itemId: item.id,
      exercise: (item.exerciseId && byId.get(item.exerciseId)) || null,
      targets: item.targets as LiftTargets,
      sets: sets
        .filter(
          (s) => s.sessionLogId === logId && s.exerciseId === item.exerciseId,
        )
        .sort((a, b) => a.index - b.index),
      lastTime: item.exerciseId ? lastTime(item.exerciseId) : [],
    })),
  };
}

/** The implement an exercise is loaded on, if it's loaded by weight. */
export function implementOf(exercise: Exercise | null): WeightImplement | null {
  const equipment = exercise?.equipment ?? [];
  if (equipment.includes("dumbbell")) return "dumbbell";
  if (equipment.includes("barbell")) return "barbell";
  if (equipment.includes("cable") || equipment.includes("machine"))
    return "stack";
  return null;
}

/** Whether the weight stepper shows: a prefilled load or a weighted implement. */
export const isWeighted = (card: LiftCard) =>
  card.targets.load !== null ||
  (card.targets.band === null && implementOf(card.exercise) !== null);

/** The weight unit of the card's sets. */
export const unitOf = (card: LiftCard, settings: PlayerSettings): WeightUnit =>
  card.targets.load?.unit ?? settings.weightUnit;

/** Stepper step for the card's weight, from the rack where there is one. */
export function weightStep(card: LiftCard, settings: PlayerSettings): number {
  const fallback = settings.weightUnit === "kg" ? 2.5 : 5;
  switch (implementOf(card.exercise)) {
    case "dumbbell":
      return settings.equipment.dumbbells?.step ?? fallback;
    case "stack":
      return settings.equipment.stackStep ?? fallback;
    default:
      return fallback;
  }
}

/**
 * The next set prefilled: the last set logged this session if there is one,
 * else the target (top of the rep range). RIR is left for the owner to pick.
 */
export function prefill(card: LiftCard): SetValues {
  const last = card.sets.at(-1);
  if (last) return { load: last.loadValue, reps: last.reps, rir: null };
  return {
    load: isWeighted(card) ? (card.targets.load?.value ?? 0) : null,
    reps: card.targets.repMax,
    rir: null,
  };
}

/**
 * Saves a set, starting the session's log with the first one. Each set goes
 * through the outbox on its own, so a killed app loses nothing (SPEC §3.1).
 */
export async function logSet(
  db: LocalDb,
  view: SessionView,
  card: LiftCard,
  values: SetValues,
  settings: PlayerSettings,
  now = Date.now(),
): Promise<void> {
  const id = sessionLogId(view.session.id);
  const existing = await db.rows("session_log").get(id);
  if (!existing || existing.deletedAt !== null) {
    await saveRow(
      db,
      "session_log",
      {
        id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        plannedSessionId: view.session.id,
        modality: "lift",
        startedAt: now,
        endedAt: null,
        localDate: localDateAt(settings.timezone, now),
        timezone: settings.timezone,
        rpe: null,
        notes: null,
      },
      now,
    );
  }
  const exerciseId = card.exercise?.id;
  if (!exerciseId) throw new Error("A set needs an exercise");
  await saveRow(
    db,
    "set_log",
    {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      sessionLogId: id,
      exerciseId,
      index: card.sets.length,
      loadValue: values.load,
      loadUnit: values.load === null ? null : unitOf(card, settings),
      band: card.targets.band,
      reps: values.reps,
      rir: values.rir,
      isWarmup: false,
      completedAt: now,
    },
    now,
  );
}

const ACTIVE_KEY = "workout-app:active-lift";

/** Remembers the session this device is logging, for {@link openWorkout}. */
export function markActive(sessionId: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, sessionId);
  } catch {
    // Without storage the app just reopens on Today.
  }
}

/**
 * The session this device was logging, if its log is still open from
 * `today`. Device-local, so a workout on the phone never takes over the laptop.
 */
export async function openWorkout(
  db: LocalDb,
  today: string,
): Promise<string | null> {
  let sessionId: string | null;
  try {
    sessionId = localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
  if (!sessionId) return null;
  const log = await db.rows("session_log").get(sessionLogId(sessionId));
  const open =
    log &&
    log.deletedAt === null &&
    log.endedAt === null &&
    log.localDate === today;
  return open ? sessionId : null;
}

/** Where the player was: the card on screen and values not yet logged. */
export type PlayerPosition = {
  card: number;
  drafts: Record<string, SetValues>;
};

// Device-local, like the onboarding flag: it only has to survive a kill.
const positionKey = (sessionId: string) =>
  `workout-app:lift-player:${sessionId}`;

export function loadPosition(sessionId: string): PlayerPosition {
  try {
    const saved = JSON.parse(
      localStorage.getItem(positionKey(sessionId)) ?? "null",
    ) as PlayerPosition | null;
    if (saved && Number.isInteger(saved.card) && saved.drafts) return saved;
  } catch {
    // A corrupt entry just starts the player at the first card.
  }
  return { card: 0, drafts: {} };
}

export function savePosition(sessionId: string, position: PlayerPosition) {
  try {
    localStorage.setItem(positionKey(sessionId), JSON.stringify(position));
  } catch {
    // Storage full or blocked: the logged sets are safe in IndexedDB anyway.
  }
}
