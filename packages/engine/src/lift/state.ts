import {
  addDays,
  daysBetween,
  type Equipment,
  type Onboarding,
  type Weight,
  type WeightUnit,
  type WeekType,
} from "@workout-app/shared";
import type { EngineConfig } from "../config.js";
import { roundDownToLoadable, type WeightImplement } from "../loads.js";
import type {
  LiftExposure,
  LiftSessionLog,
  LiftSet,
  LiftTarget,
} from "../stubs/lift.js";
import { toWeightUnit } from "../units.js";

/** Stored with every `fitness_state` row the lift engine writes. */
export const LIFT_ENGINE_VERSION = "lift-3";

/** One exercise's engine state (SPEC §5.1). */
export type ExerciseState = {
  /** Per dumbbell for dumbbell lifts; null until a loaded set estimates it. */
  e1rm: Weight | null;
  /** 0–1, rising with each exposure that estimates e1RM. */
  confidence: number;
  /** Oldest first, at most `exposuresKept`. */
  exposures: LiftExposure[];
  /** Calibration mode runs from here (§5.0). Null until a session is logged. */
  firstLoggedDate: string | null;
  /** Stalls since the exercise last hit the top of its range (§5.1). */
  stallCount: number;
  /** The date of the latest stall, for the early deload (§5.1). */
  lastStallDate: string | null;
  /** The last date the e1RM estimate rose. */
  lastIncreaseDate: string | null;
  /** How the latest exposure went against its target; null when unplanned. */
  lastOutcome: Outcome | null;
  /** Consecutive missed exposures since the last stall. */
  missStreak: number;
  /** Plateaus so far, which picks the next plateau fix. */
  plateaus: number;
  /** The plateau fix in force, if any (§5.1). */
  plateau: { action: PlateauAction; startedOn: string } | null;
  /** A block stall waiting for its next loading block or prescription. */
  blockStall: {
    blockId: string;
    date: string;
    status: "pending" | "counted" | "ignored";
    progressionOutcome: Outcome | null;
  } | null;
};

/**
 * `missed`: a set at the prescribed load fell short of the range's bottom.
 * `stalled`: the second miss in a row. `top`: every set reached the top of
 * the range at the target RIR or easier; `beat` went past it. `done`: neither.
 */
export const OUTCOMES = ["missed", "stalled", "top", "beat", "done"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const PLATEAU_ACTIONS = ["rep_scheme", "back_off", "variation"] as const;
export type PlateauAction = (typeof PLATEAU_ACTIONS)[number];

export type LiftEngineState = { exercises: Record<string, ExerciseState> };

export type LiftCalendarBlock = {
  id: string;
  startDate: string;
  index: number;
  weekCount: number;
};

export type LiftStateCalendar = {
  weekTypeOf?: (date: string) => WeekType | null;
  blockOf?: (date: string) => LiftCalendarBlock | null;
  progressionModelOf?: (
    exerciseId: string,
  ) => "double_progression" | "e1rm_rir" | null;
  targetProgressed?: (previous: LiftTarget, current: LiftTarget) => boolean;
};

type Lift = EngineConfig["lift"];

/** Epley with reps adjusted for RIR: the 1RM a set of `reps` at `rir` implies. */
export const e1rmOf = (load: number, reps: number, rir: number): number =>
  load * (1 + (reps + rir) / 30);

/** The load for `reps` at `rir` from an e1RM: {@link e1rmOf} inverted. */
export const loadFor = (e1rm: number, reps: number, rir: number): number =>
  e1rm / (1 + (reps + rir) / 30);

/**
 * The prescribed load for `reps` at `rir`, in `unit`, rounded down to the
 * heaviest load the equipment can make. If none is light enough, use the
 * lightest available load. Null when the equipment can't make one.
 */
export function prescribedLoad(
  e1rm: Weight,
  reps: number,
  rir: number,
  unit: WeightUnit,
  equipment: Equipment,
  implement: WeightImplement,
): Weight | null {
  const target = loadFor(toWeightUnit(e1rm, unit), reps, rir);
  const value = roundDownToLoadable(equipment, implement, target);
  return value === null ? null : { value, unit };
}

/**
 * A session's e1RM estimate, in `unit`: the best hard set's (§5.1). Sets
 * without a load, or where reps + RIR exceed `maxRepsPlusRir`, are skipped.
 * A set logged without RIR counts as RIR 0, the lower estimate.
 */
export function sessionEstimate(
  sets: readonly LiftSet[],
  unit: WeightUnit,
  config: Lift,
): number | null {
  let best: number | null = null;
  for (const set of sets) {
    const rir = set.rir ?? 0;
    if (set.load === null || set.load.value <= 0 || set.reps < 1) continue;
    if (set.reps + rir > config.maxRepsPlusRir) continue;
    const estimate = e1rmOf(toWeightUnit(set.load, unit), set.reps, rir);
    if (best === null || estimate > best) best = estimate;
  }
  return best;
}

/** Whether an exercise is still in calibration mode on `date` (§5.0). */
export function isCalibrating(
  exercise: Pick<ExerciseState, "firstLoggedDate">,
  date: string,
  config: Lift,
): boolean {
  const first = exercise.firstLoggedDate;
  return first === null || date < addDays(first, config.calibration.days);
}

/**
 * Asymmetric smoothing toward the session estimate, with the rise capped
 * (§5.1). Calibration mode caps the rise tighter.
 */
export function smoothE1rm(
  previous: number,
  estimate: number,
  calibrating: boolean,
  config: Lift,
): number {
  const alpha = estimate > previous ? config.alphaUp : config.alphaDown;
  const smoothed = previous + alpha * (estimate - previous);
  const maxRise = calibrating ? config.calibration.maxRise : config.maxRise;
  return Math.min(smoothed, previous * (1 + maxRise));
}

const raiseConfidence = (confidence: number, config: Lift) =>
  confidence + (1 - confidence) * config.confidenceStep;

const emptyExercise = (): ExerciseState => ({
  e1rm: null,
  confidence: 0,
  exposures: [],
  firstLoggedDate: null,
  stallCount: 0,
  lastStallDate: null,
  lastIncreaseDate: null,
  lastOutcome: null,
  missStreak: 0,
  plateaus: 0,
  plateau: null,
  blockStall: null,
});

const EPSILON = 1e-6;

/**
 * Judges an exposure's working sets against what was planned, ignoring sets
 * lighter than the prescribed load. Null when no set was at the target, as
 * when the owner went lighter. A set without RIR counts as RIR 0.
 */
export function judgeExposure(
  sets: readonly LiftSet[],
  target: LiftTarget,
  missToleranceReps: number,
  config: Lift,
): Exclude<Outcome, "stalled"> | null {
  const atTarget = sets.filter((set) => {
    if (target.load !== null) {
      return (
        set.load !== null &&
        toWeightUnit(set.load, target.load.unit) >= target.load.value - EPSILON
      );
    }
    return set.band === target.band;
  });
  if (atTarget.length === 0) return null;
  if (atTarget.some((s) => s.reps < target.repMin - missToleranceReps)) {
    return "missed";
  }
  const rirOf = (set: LiftSet) => set.rir ?? 0;
  const top =
    atTarget.length >= target.sets &&
    atTarget.every(
      (s) =>
        s.reps >= target.repMax &&
        (target.targetRir === null || rirOf(s) >= target.targetRir),
    );
  if (!top) return "done";
  const margin = config.progression.beatRirMargin;
  const beat = atTarget.every(
    (s) =>
      s.reps > target.repMax ||
      (target.targetRir !== null && rirOf(s) >= target.targetRir + margin),
  );
  return beat ? "beat" : "top";
}

/** Records either kind of stall and starts a plateau at the shared threshold. */
function recordStall(
  next: ExerciseState,
  lastStallDate: string,
  startedOn: string,
  config: Lift,
): void {
  next.lastOutcome = "stalled";
  next.lastStallDate = lastStallDate;
  next.stallCount += 1;
  if (next.stallCount >= config.progression.stallsToPlateau) {
    next.stallCount = 0;
    next.plateau = {
      action: PLATEAU_ACTIONS[next.plateaus % PLATEAU_ACTIONS.length]!,
      startedOn,
    };
    next.plateaus += 1;
  }
}

function plateauActive(
  state: ExerciseState,
  date: string,
  config: Lift,
): boolean {
  return (
    state.plateau !== null &&
    date < addDays(state.plateau.startedOn, config.progression.plateauDays)
  );
}

function blockStallDate(
  exposures: readonly LiftExposure[],
  block: LiftCalendarBlock,
  calendar: LiftStateCalendar,
): string | null {
  const inBlock = exposures.filter((exposure) => {
    const exposureBlock = calendar.blockOf?.(exposure.date);
    return (
      exposure.source === "log" &&
      exposure.target !== null &&
      exposure.target !== undefined &&
      exposureBlock?.id === block.id &&
      calendar.weekTypeOf?.(exposure.date) === "loading"
    );
  });
  if (inBlock.length < 2) return null;

  const previous = exposures
    .filter((exposure) => {
      const exposureBlock = calendar.blockOf?.(exposure.date);
      return (
        exposure.source === "log" &&
        exposure.target !== null &&
        exposure.target !== undefined &&
        exposureBlock !== null &&
        exposureBlock !== undefined &&
        exposureBlock.startDate < block.startDate &&
        calendar.weekTypeOf?.(exposure.date) === "loading"
      );
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  const targets = [
    ...(previous?.target ? [previous.target] : []),
    ...inBlock
      .sort((a, b) => a.date.localeCompare(b.date))
      .flatMap((exposure) => (exposure.target ? [exposure.target] : [])),
  ];
  const progressed =
    calendar.targetProgressed ??
    ((before, after) => after.repMax > before.repMax);
  if (
    targets
      .slice(1)
      .some((target, index) => progressed(targets[index]!, target))
  ) {
    return null;
  }
  return (
    exposures
      .filter((exposure) => {
        const exposureBlock = calendar.blockOf?.(exposure.date);
        return (
          exposure.source === "log" &&
          exposureBlock?.id === block.id &&
          calendar.weekTypeOf?.(exposure.date) === "loading"
        );
      })
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1)?.date ?? null
  );
}

function noteBlockStall(
  next: ExerciseState,
  exposures: readonly LiftExposure[],
  block: LiftCalendarBlock,
  date: string,
  config: Lift,
  calendar: LiftStateCalendar,
  pending: boolean,
): void {
  const stalledAt = blockStallDate(exposures, block, calendar);
  if (stalledAt === null) return;
  if (plateauActive(next, date, config)) {
    next.blockStall = {
      blockId: block.id,
      date: stalledAt,
      status: "ignored",
      progressionOutcome: null,
    };
    return;
  }
  if (pending) {
    next.blockStall = {
      blockId: block.id,
      date: stalledAt,
      status: "pending",
      progressionOutcome: next.lastOutcome,
    };
    return;
  }
  const progressionOutcome = next.lastOutcome;
  recordStall(next, stalledAt, date, config);
  next.blockStall = {
    blockId: block.id,
    date: stalledAt,
    status: "counted",
    progressionOutcome,
  };
}

function applyPendingBlockStall(
  next: ExerciseState,
  date: string,
  config: Lift,
): void {
  const pending = next.blockStall;
  if (pending?.status !== "pending") return;
  if (plateauActive(next, date, config)) {
    next.blockStall = null;
    return;
  }
  recordStall(next, pending.date, date, config);
  next.blockStall = { ...pending, status: "counted" };
}

/** The miss, stall and plateau bookkeeping after an exposure (§5.1 Rules). */
function judgeInto(
  next: ExerciseState,
  exposure: LiftExposure,
  calibrating: boolean,
  config: Lift,
): void {
  if (exposure.deload) return;
  const target = exposure.target ?? null;
  if (target !== null) next.blockStall = null;
  const outcome =
    target === null
      ? null
      : judgeExposure(
          exposure.sets,
          target,
          calibrating ? config.calibration.missToleranceReps : 0,
          config,
        );
  next.lastOutcome = outcome;
  if (outcome === null) return;
  if (outcome !== "missed") {
    next.missStreak = 0;
    if (outcome !== "done") next.stallCount = 0;
    return;
  }
  if (next.missStreak + 1 < 2) {
    next.missStreak += 1;
    return;
  }
  next.missStreak = 0;
  recordStall(next, exposure.date, exposure.date, config);
}

/**
 * Starting state from the onboarding answers (§5.0 cold start): each main
 * lift's recent working set estimates its e1RM and counts as one exposure.
 */
export function initLiftEngineState(
  onboarding: Onboarding | null,
  config: Lift,
): LiftEngineState {
  const exercises: Record<string, ExerciseState> = {};
  for (const lift of onboarding?.lifts ?? []) {
    const set: LiftSet = {
      load: lift.load,
      band: null,
      reps: lift.reps,
      rir: lift.rir,
    };
    const estimate = sessionEstimate([set], lift.load.unit, config);
    exercises[lift.exerciseId] = {
      ...emptyExercise(),
      e1rm:
        estimate === null ? null : { value: estimate, unit: lift.load.unit },
      confidence: estimate === null ? 0 : raiseConfidence(0, config),
      exposures: [{ date: "", source: "onboarding", sets: [set] }],
    };
  }
  return { exercises };
}

function foldExposure(
  exerciseId: string,
  previous: ExerciseState,
  exposure: LiftExposure,
  config: Lift,
  calendar?: LiftStateCalendar,
): ExerciseState {
  const foldedExposure =
    calendar?.weekTypeOf?.(exposure.date) === "deload"
      ? { ...exposure, deload: true as const }
      : exposure;
  const firstLoggedDate = previous.firstLoggedDate ?? exposure.date;
  const lastLogged = previous.exposures.findLast((e) => e.source === "log");
  const calibrating = isCalibrating({ firstLoggedDate }, exposure.date, config);
  const next: ExerciseState = {
    ...previous,
    firstLoggedDate,
    exposures: [...previous.exposures, foldedExposure].slice(
      -config.exposuresKept,
    ),
  };
  const previousBlock =
    lastLogged === undefined
      ? null
      : (calendar?.blockOf?.(lastLogged.date) ?? null);
  const currentBlock = calendar?.blockOf?.(exposure.date) ?? null;
  const previousWeekType =
    lastLogged === undefined
      ? null
      : (calendar?.weekTypeOf?.(lastLogged.date) ?? null);
  const currentWeekType = calendar?.weekTypeOf?.(exposure.date) ?? null;

  if (
    currentWeekType === "deload" &&
    previousBlock !== null &&
    currentBlock !== null &&
    previousBlock?.id === currentBlock?.id &&
    previousWeekType === "loading" &&
    calendar?.progressionModelOf?.(exerciseId) === "double_progression" &&
    next.blockStall === null
  ) {
    noteBlockStall(
      next,
      previous.exposures,
      currentBlock,
      exposure.date,
      config,
      calendar,
      true,
    );
  } else if (
    currentWeekType !== "deload" &&
    previousBlock !== null &&
    currentBlock !== null &&
    previousBlock.id !== currentBlock.id
  ) {
    if (next.blockStall?.status === "pending") {
      applyPendingBlockStall(next, exposure.date, config);
    } else if (
      next.blockStall?.blockId !== previousBlock.id &&
      previousWeekType === "loading" &&
      calendar?.progressionModelOf?.(exerciseId) === "double_progression"
    ) {
      noteBlockStall(
        next,
        previous.exposures,
        previousBlock,
        exposure.date,
        config,
        calendar,
        false,
      );
    }
  }
  judgeInto(next, foldedExposure, calibrating, config);
  const unit =
    previous.e1rm?.unit ??
    exposure.sets.find((s) => s.load !== null)?.load?.unit;
  if (unit === undefined) return next;
  const estimate = sessionEstimate(exposure.sets, unit, config);
  if (estimate === null) return next;
  next.confidence = raiseConfidence(previous.confidence, config);
  if (previous.e1rm === null) {
    next.e1rm = { value: estimate, unit };
    return next;
  }
  // After a long layoff a weaker session replaces the estimate outright (§5.1).
  const recalibrate =
    lastLogged !== undefined &&
    daysBetween(lastLogged.date, exposure.date) >= config.layoff.longDays &&
    estimate < previous.e1rm.value;
  const value = recalibrate
    ? estimate
    : smoothE1rm(previous.e1rm.value, estimate, calibrating, config);
  next.e1rm = { value, unit };
  if (value > previous.e1rm.value + 1e-9) {
    next.lastIncreaseDate = exposure.date;
  }
  return next;
}

/**
 * Folds one session into the state: each exercise's working sets become an
 * exposure, and loaded sets update its e1RM. A session older than an
 * exercise's latest logged exposure leaves that exercise alone, so fold logs
 * oldest first.
 */
export function updateLiftEngineState(
  state: LiftEngineState,
  log: LiftSessionLog,
  config: Lift,
  calendar?: LiftStateCalendar,
): LiftEngineState {
  const byExercise = new Map<string, LiftSessionLog["sets"][number][]>();
  for (const set of log.sets) {
    if (set.isWarmup) continue;
    byExercise.set(set.exerciseId, [
      ...(byExercise.get(set.exerciseId) ?? []),
      set,
    ]);
  }
  const exercises = { ...state.exercises };
  const date = log.session.localDate;
  for (const [exerciseId, sets] of byExercise) {
    const previous = exercises[exerciseId] ?? emptyExercise();
    const latest = previous.exposures.at(-1);
    if (latest?.source === "log" && latest.date > date) continue;
    exercises[exerciseId] = foldExposure(
      exerciseId,
      previous,
      {
        date,
        source: "log",
        target: log.targets?.[exerciseId] ?? null,
        sets: [...sets]
          .sort((a, b) => a.index - b.index)
          .map((s) => ({
            load:
              s.loadValue === null || s.loadUnit === null
                ? null
                : { value: s.loadValue, unit: s.loadUnit },
            band: s.band,
            reps: s.reps,
            rir: s.rir,
          })),
      },
      config,
      calendar,
    );
  }
  return { exercises };
}

/** Applies a completed block stall before planning a later block. */
export function applyBlockStallsBeforePlan(
  state: LiftEngineState,
  currentBlockId: string,
  currentBlockStartDate: string,
  config: Lift,
  calendar: LiftStateCalendar,
): LiftEngineState {
  const exercises = { ...state.exercises };
  for (const [exerciseId, exercise] of Object.entries(state.exercises)) {
    if (calendar.progressionModelOf?.(exerciseId) !== "double_progression") {
      continue;
    }
    const latest = exercise.exposures.findLast(
      (exposure) => exposure.source === "log",
    );
    if (latest === undefined) continue;
    const latestBlock = calendar.blockOf?.(latest.date) ?? null;
    if (
      latestBlock === null ||
      latestBlock.id === currentBlockId ||
      latestBlock.startDate >= currentBlockStartDate
    ) {
      continue;
    }
    const next = { ...exercise };
    if (
      next.blockStall?.status !== "pending" &&
      next.blockStall?.blockId === latestBlock.id
    ) {
      continue;
    }
    if (next.blockStall?.status === "pending") {
      applyPendingBlockStall(next, currentBlockStartDate, config);
    } else if (calendar.weekTypeOf?.(latest.date) === "loading") {
      noteBlockStall(
        next,
        exercise.exposures,
        latestBlock,
        currentBlockStartDate,
        config,
        calendar,
        false,
      );
    }
    exercises[exerciseId] = next;
  }
  return { exercises };
}

/** One point of an exercise's e1RM time series (`fitness_state`, §4). */
export type E1rmPoint = {
  exerciseId: string;
  date: string;
  e1rm: Weight;
  confidence: number;
};

/**
 * Every exercise's e1RM after each day it was trained, oldest first, from the
 * onboarding answers (dated `onboardingDate`, or left out when that's null)
 * and the lift logs. A day with two sessions gives one point, after both.
 */
export function e1rmSeries(
  onboarding: Onboarding | null,
  onboardingDate: string | null,
  logs: readonly LiftSessionLog[],
  config: Lift,
): E1rmPoint[] {
  let state = initLiftEngineState(onboarding, config);
  const points = new Map<string, E1rmPoint>();
  const record = (exerciseId: string, date: string) => {
    const { e1rm, confidence } = state.exercises[exerciseId] ?? {};
    if (!e1rm || confidence === undefined) return;
    points.set(`${exerciseId}:${date}`, { exerciseId, date, e1rm, confidence });
  };
  if (onboardingDate !== null) {
    for (const exerciseId of Object.keys(state.exercises)) {
      record(exerciseId, onboardingDate);
    }
  }
  const ordered = [...logs].sort((a, b) =>
    a.session.localDate.localeCompare(b.session.localDate),
  );
  for (const log of ordered) {
    state = updateLiftEngineState(state, log, config);
    for (const set of log.sets) {
      if (!set.isWarmup) record(set.exerciseId, log.session.localDate);
    }
  }
  return [...points.values()].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.exerciseId.localeCompare(b.exerciseId),
  );
}
