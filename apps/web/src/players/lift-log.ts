import {
  availableLoads,
  equipmentRank,
  roundToLoadable,
  toWeightUnit,
  type WeightImplement,
} from "@workout-app/engine";
import {
  localDateAt,
  newId,
  sessionLogId,
  type Exercise,
  type PlannedItem,
  type SessionLog,
  type Settings,
  type SetLog,
  type WeightUnit,
  isTemplateModality,
} from "@workout-app/shared";
import { itemOverrides } from "../plan/item-overrides";
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
  item: Pick<PlannedItem, "id" | "plannedSessionId" | "exerciseId">;
  /** The exercise being done: the planned one, or what it was swapped for. */
  exercise: Exercise | null;
  /** The exercises it can be swapped for, preferred first (SPEC §5.1). */
  substitutes: Exercise[];
  skipped: boolean;
  targets: LiftTargets;
  /** This session's working sets of the exercise, in order. */
  sets: SetLog[];
  /** This session's warm-up sets of the exercise, in order. */
  warmups: SetLog[];
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
  const overrides = itemOverrides(await db.rows("plan_override").toArray());
  const exerciseOf = (item: PlannedItem) =>
    overrides.swaps.get(item.id) ?? item.exerciseId;
  const ids = new Set(
    items.flatMap((i) => {
      const id = exerciseOf(i);
      return id ? [id] : [];
    }),
  );
  const logId = sessionLogId(view.session.id);
  const log = (await db.rows("session_log").get(logId)) ?? null;
  const sets = live(await db.rows("set_log").toArray()).filter((s) =>
    ids.has(s.exerciseId),
  );
  const logs = new Map(
    live(await db.rows("session_log").toArray()).map((l) => [l.id, l]),
  );
  const exercises = live(await db.rows("exercise").toArray()).filter((e) =>
    isTemplateModality(e.modality),
  );
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const substitutes = (planned: Exercise | null, current: Exercise | null) => {
    const group = (planned ?? current)?.substitutionGroup ?? null;
    const options = exercises.filter(
      (e) =>
        e.id === planned?.id ||
        e.id === current?.id ||
        (group !== null && e.substitutionGroup === group),
    );
    return options.sort(
      (a, b) =>
        equipmentRank(a) - equipmentRank(b) || a.name.localeCompare(b.name),
    );
  };

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
    cards: items.map((item) => {
      const planned = (item.exerciseId && byId.get(item.exerciseId)) || null;
      const exerciseId = exerciseOf(item);
      const exercise = (exerciseId && byId.get(exerciseId)) || null;
      const mine = sets
        .filter((s) => s.sessionLogId === logId && s.exerciseId === exerciseId)
        .sort((a, b) => a.index - b.index);
      return {
        itemId: item.id,
        item: {
          id: item.id,
          plannedSessionId: item.plannedSessionId,
          exerciseId: item.exerciseId,
        },
        exercise,
        substitutes: substitutes(planned, exercise),
        skipped: overrides.skips.has(item.id),
        targets: item.targets as LiftTargets,
        sets: mine.filter((s) => !s.isWarmup),
        warmups: mine.filter((s) => s.isWarmup),
        lastTime: exerciseId ? lastTime(exerciseId) : [],
      };
    }),
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

// Warm-up ramp (SPEC §5.1): share of the first working load, and reps.
const RAMP = [
  { share: 0.4, reps: 8 },
  { share: 0.6, reps: 5 },
  { share: 0.8, reps: 3 },
];

/**
 * The warm-up sets for a card: about 40/60/80% of the first working load,
 * rounded to weights the inventory has. Steps that round to nothing, to the
 * working load or to the step before are dropped. Empty for unweighted cards.
 */
export function warmupPlan(
  card: LiftCard,
  settings: PlayerSettings,
  workingLoad: number | null,
): SetValues[] {
  if (!isWeighted(card) || workingLoad === null || workingLoad <= 0) return [];
  const inModel = implementOf(card.exercise) !== null;
  const step = weightStep(settings);
  const plan: SetValues[] = [];
  for (const { share, reps } of RAMP) {
    const raw = workingLoad * share;
    const load = inModel
      ? snapLoad(card, settings, raw)
      : Math.round(raw / step) * step;
    if (load === null || load <= 0 || load >= workingLoad) continue;
    if (plan.some((p) => p.load === load)) continue;
    plan.push({ load, band: null, reps, rir: null });
  }
  return plan;
}

/**
 * The cards that get warm-ups: those marked `ramp`, minus later ones whose
 * movement pattern an earlier card already warmed up (SPEC §5.1). Skipped
 * cards don't count.
 */
export function warmupCards(cards: readonly LiftCard[]): Set<string> {
  const warmed = new Set<string>();
  const result = new Set<string>();
  for (const card of cards) {
    if (card.skipped || !card.exercise || card.targets.ramp === false) continue;
    const pattern = card.exercise.movementPattern;
    if (pattern !== null && warmed.has(pattern)) continue;
    if (pattern !== null) warmed.add(pattern);
    result.add(card.itemId);
  }
  return result;
}

/**
 * Saves a set, starting the session's log with the first one. Each set goes
 * through the outbox on its own, so a killed app loses nothing (SPEC §3.1).
 * Warm-ups are numbered apart from working sets and kept out of their stats.
 */
export async function logSet(
  db: LocalDb,
  view: SessionView,
  card: LiftCard,
  values: SetValues,
  settings: PlayerSettings,
  now = Date.now(),
  warmup = false,
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
      index: warmup ? card.warmups.length : card.sets.length,
      loadValue: values.load,
      loadUnit: values.load === null ? null : unitOf(card, settings),
      band: values.band,
      reps: values.reps,
      rir: values.rir,
      isWarmup: warmup,
      completedAt: now,
    },
    now,
  );
}

/** What the owner says about the session when finishing it. */
export type Finish = { rpe: number; notes: string | null };

/**
 * Finishes the session's log with its RPE and notes; the planned session then
 * reads as done. The player's saved position and this device's active-workout
 * pointer are cleared, so Today no longer reopens it.
 */
export async function finishSession(
  db: LocalDb,
  view: SessionView,
  { rpe, notes }: Finish,
  now = Date.now(),
): Promise<void> {
  const log = await db.rows("session_log").get(sessionLogId(view.session.id));
  if (!log || log.deletedAt !== null) throw new Error("Nothing logged yet");
  await saveRow(
    db,
    "session_log",
    {
      id: log.id,
      createdAt: log.createdAt,
      updatedAt: now,
      deletedAt: null,
      plannedSessionId: log.plannedSessionId,
      modality: log.modality,
      startedAt: log.startedAt,
      endedAt: now,
      localDate: log.localDate,
      timezone: log.timezone,
      rpe,
      notes: notes?.trim() || null,
    },
    now,
  );
  try {
    localStorage.removeItem(positionKey(view.session.id));
    if (localStorage.getItem(ACTIVE_KEY) === view.session.id) {
      localStorage.removeItem(ACTIVE_KEY);
    }
  } catch {
    // Without storage there's nothing to clear.
  }
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
  /** Sets added past the plan, by planned item. */
  extra?: Record<string, number>;
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
