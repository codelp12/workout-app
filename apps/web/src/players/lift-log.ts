import {
  availableLoads,
  roundToLoadable,
  toWeightUnit,
  type WeightImplement,
} from "@workout-app/engine";
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
  /** The band from the inventory, for band sets. */
  band: string | null;
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

/** Whether the card takes a weight: a prefilled load or a weighted implement. */
export const isWeighted = (card: LiftCard) =>
  card.targets.load !== null ||
  (card.targets.band === null && implementOf(card.exercise) !== null);

/** Whether the card's sets use a band. */
export const isBanded = (card: LiftCard) =>
  card.targets.band !== null ||
  (!isWeighted(card) && (card.exercise?.equipment ?? []).includes("band"));

/**
 * The weight unit of the card's sets: the inventory's for implements it
 * covers, else the target's.
 */
export const unitOf = (card: LiftCard, settings: PlayerSettings): WeightUnit =>
  implementOf(card.exercise) === null
    ? (card.targets.load?.unit ?? settings.weightUnit)
    : settings.weightUnit;

/** Stepper step for weights the inventory doesn't cover (kettlebells and the like). */
export const weightStep = (settings: PlayerSettings): number =>
  settings.weightUnit === "kg" ? 2.5 : 5;

// A stack has no top, so the picker lists this many steps, or 10 past the
// current load if that's further.
const STACK_CHOICES = 50;

/**
 * Snaps `load` to the nearest weight the inventory can make for the card
 * (the lighter on a tie). Null when the inventory has none; unchanged when
 * the card's implement isn't in the inventory model.
 */
export function snapLoad(
  card: LiftCard,
  settings: PlayerSettings,
  load: number,
): number | null {
  const implement = implementOf(card.exercise);
  if (implement === null) return load;
  if (implement !== "barbell" && implement !== "bar") {
    return roundToLoadable(settings.equipment, implement, load);
  }
  return nearest(barbellLoads(settings), load);
}

/**
 * Every weight the picker offers for the card, lightest first: the dumbbell
 * rack, fixed barbells plus anything the loadable bar makes, or stack steps.
 * Null when the card's implement isn't in the inventory model (the plain
 * stepper is used instead); empty when the inventory has none of it.
 */
export function loadChoices(
  card: LiftCard,
  settings: PlayerSettings,
  current: number | null,
): number[] | null {
  const { equipment } = settings;
  switch (implementOf(card.exercise)) {
    case null:
      return null;
    case "dumbbell":
      return availableLoads(equipment, "dumbbell");
    case "barbell":
    case "bar":
      return barbellLoads(settings);
    case "stack": {
      const step = equipment.stackStep;
      if (step === null) return [];
      const count = Math.max(
        STACK_CHOICES,
        Math.ceil((current ?? 0) / step) + 10,
      );
      return Array.from({ length: count }, (_, i) =>
        roundToLoadable(equipment, "stack", (i + 1) * step)!,
      );
    }
  }
}

/** The bands the picker offers, lightest first; null for non-band cards. */
export const bandChoices = (
  card: LiftCard,
  settings: PlayerSettings,
): string[] | null => (isBanded(card) ? settings.equipment.bands : null);

function barbellLoads({ equipment }: PlayerSettings): number[] {
  const loads = [
    ...availableLoads(equipment, "barbell"),
    ...availableLoads(equipment, "bar"),
  ];
  return [...new Set(loads)].sort((a, b) => a - b);
}

function nearest(loads: readonly number[], target: number): number | null {
  let best: number | null = null;
  for (const load of loads) {
    if (best === null || Math.abs(load - target) < Math.abs(best - target)) {
      best = load;
    }
  }
  return best;
}

/**
 * Brings saved or prefilled values in line with the inventory, which may
 * have changed since: the load snaps to the nearest one on offer and a band
 * that's gone falls back to the lightest.
 */
export function settle(
  card: LiftCard,
  settings: PlayerSettings,
  values: SetValues,
): SetValues {
  const load =
    values.load === null ? null : snapLoad(card, settings, values.load);
  const bands = bandChoices(card, settings);
  const band =
    bands === null
      ? null
      : bands.length === 0
        ? (values.band ?? null)
        : values.band !== null && bands.includes(values.band)
          ? values.band
          : (bands[0] ?? null);
  return { ...values, load, band };
}

/**
 * The next set prefilled: the last set logged this session if there is one,
 * else the target (top of the rep range), snapped to the inventory. RIR is
 * left for the owner to pick.
 */
export function prefill(card: LiftCard, settings: PlayerSettings): SetValues {
  const unit = unitOf(card, settings);
  const last = card.sets.at(-1);
  const raw: SetValues = last
    ? {
        load:
          last.loadValue === null
            ? null
            : toWeightUnit(
                { value: last.loadValue, unit: last.loadUnit ?? unit },
                unit,
              ),
        band: last.band,
        reps: last.reps,
        rir: null,
      }
    : {
        load: isWeighted(card)
          ? card.targets.load
            ? toWeightUnit(card.targets.load, unit)
            : 0
          : null,
        band: card.targets.band,
        reps: card.targets.repMax,
        rir: null,
      };
  return settle(card, settings, raw);
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
      band: values.band,
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
