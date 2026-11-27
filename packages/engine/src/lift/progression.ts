import {
  addDays,
  type Exercise,
  type ProgressionModel,
  type TemplateSlot,
  type Weight,
} from "@workout-app/shared";
import type { EngineConfig } from "../config.js";
import {
  roundDownToLoadable,
  roundToLoadable,
  type WeightImplement,
} from "../loads.js";
import {
  equipmentRank,
  implementOf,
  topSet,
  type LiftExposure,
  type LiftSet,
  type LiftTarget,
} from "../stubs/lift.js";
import type { EngineContext, Reason } from "../types.js";
import { formatAmount, toWeightUnit } from "../units.js";
import {
  isCalibrating,
  loadFor,
  type ExerciseState,
  type PlateauAction,
} from "./state.js";

export type ProgressionExercise = Pick<
  Exercise,
  | "id"
  | "name"
  | "equipment"
  | "substitutionGroup"
  | "progressionModel"
  | "increment"
>;

/** The slot's scheme for this week, after the block's RIR step and sets ({@link weekScheme}). */
export type SlotScheme = Pick<
  TemplateSlot,
  "sets" | "repMin" | "repMax" | "targetRir"
>;

export type ExercisePrescription = LiftTarget & {
  /** A plateau back-off set after the working sets, if any. */
  backOff: { load: Weight | null; band: string | null; reps: number } | null;
  /** A same-group variation the plateau handler swaps in for a block. */
  swapTo: string | null;
  reasons: Reason[];
};

type Lift = EngineConfig["lift"];
type Progression = Lift["progression"];

/** The exercise's model, or `double_progression` when it has none (§5.1). */
export const modelOf = (
  exercise: Pick<Exercise, "progressionModel">,
): ProgressionModel => exercise.progressionModel ?? "double_progression";

const EPSILON = 1e-6;

/** How the exercise's resistance moves in steps. */
type Loading =
  | { kind: "weight"; implement: WeightImplement }
  | { kind: "band" }
  | { kind: "fixed" };

function loadingOf(exercise: ProgressionExercise, ctx: EngineContext): Loading {
  const implement = implementOf(exercise);
  if (implement === "barbell" && ctx.equipment.barbells.length === 0) {
    if (ctx.equipment.bar !== null) return { kind: "weight", implement: "bar" };
  }
  if (implement !== null) return { kind: "weight", implement };
  if (exercise.equipment.includes("band") && ctx.equipment.bands.length > 0) {
    return { kind: "band" };
  }
  return { kind: "fixed" };
}

const fmt = (w: Weight) => formatAmount(w.value, w.unit);

function heaviestLoggedLoad(
  sets: readonly LiftSet[],
  unit: EngineContext["weightUnit"],
): Weight | null {
  let heaviest: Weight | null = null;
  for (const set of sets) {
    if (
      set.load !== null &&
      (heaviest === null ||
        toWeightUnit(set.load, unit) > toWeightUnit(heaviest, unit))
    ) {
      heaviest = set.load;
    }
  }
  return heaviest;
}

function lastWorkingLoad(
  last: LiftExposure,
  target: LiftTarget | null,
  exercise: ProgressionExercise,
  loading: Loading,
  ctx: EngineContext,
): Weight | null {
  return (
    target?.load ??
    (loading.kind === "weight" || exercise.equipment.includes("kettlebell")
      ? heaviestLoggedLoad(last.sets, ctx.weightUnit)
      : null)
  );
}

function allSetsAtLoad(
  sets: readonly LiftSet[],
  load: Weight,
  unit: EngineContext["weightUnit"],
): boolean {
  const value = toWeightUnit(load, unit);
  return (
    sets.length > 0 &&
    sets.every(
      (set) =>
        set.load !== null &&
        Math.abs(toWeightUnit(set.load, unit) - value) <= EPSILON,
    )
  );
}

/** `load` in the context's unit, rounded to what the equipment can make. */
function loadable(
  load: Weight,
  loading: Loading,
  ctx: EngineContext,
): Weight | null {
  const value = toWeightUnit(load, ctx.weightUnit);
  if (loading.kind !== "weight") return { value, unit: ctx.weightUnit };
  const rounded = roundToLoadable(ctx.equipment, loading.implement, value);
  return rounded === null ? null : { value: rounded, unit: ctx.weightUnit };
}

/** The load `steps` increments above `load`, or null when there isn't one. */
function stepUp(
  load: Weight,
  steps: number,
  exercise: ProgressionExercise,
  loading: Loading,
  ctx: EngineContext,
): Weight | null {
  if (loading.kind !== "weight") return null;
  let value = toWeightUnit(load, ctx.weightUnit);
  for (let i = 0; i < steps; i++) {
    const target =
      exercise.increment === null
        ? value + 0.001
        : value + toWeightUnit(exercise.increment, ctx.weightUnit);
    const next = roundToLoadable(
      ctx.equipment,
      loading.implement,
      target,
      "up",
    );
    if (next === null || next <= value + EPSILON) return null;
    value = next;
  }
  return { value, unit: ctx.weightUnit };
}

/** A load about `cut` lighter, and always at least one step down. */
function cutLoad(
  load: Weight,
  cut: number,
  loading: Loading,
  ctx: EngineContext,
): Weight {
  const value = toWeightUnit(load, ctx.weightUnit);
  if (loading.kind !== "weight") return { value, unit: ctx.weightUnit };
  const { equipment } = ctx;
  const nearest = roundToLoadable(
    equipment,
    loading.implement,
    value * (1 - cut),
  );
  const lighter =
    nearest !== null && nearest < value - EPSILON
      ? nearest
      : roundToLoadable(equipment, loading.implement, value - 0.001, "down");
  return { value: lighter ?? value, unit: ctx.weightUnit };
}

function bandStep(band: string, steps: number, ctx: EngineContext) {
  const index = ctx.equipment.bands.indexOf(band);
  if (index < 0) return null;
  return ctx.equipment.bands[index + steps] ?? null;
}

const isPlateauActive = (
  state: ExerciseState | undefined,
  date: string,
  config: Progression,
): state is ExerciseState & { plateau: { action: PlateauAction } } =>
  state?.plateau != null &&
  date < addDays(state.plateau.startedOn, config.plateauDays);

/** The slot's rep range shifted for a plateau: heavier ranges go up, light ones down. */
function shiftedScheme(slot: SlotScheme, shift: number): SlotScheme {
  const width = slot.repMax - slot.repMin;
  const repMin =
    slot.repMax <= 8 ? slot.repMin + shift : Math.max(3, slot.repMin - shift);
  return { ...slot, repMin, repMax: repMin + width };
}

/**
 * The next prescription for one exercise (SPEC §5.1 Rules, Increments):
 * `e1rm_rir` derives load from e1RM, `double_progression` steps the last load,
 * and both hold after a miss, act on stalls and run the plateau handler.
 * `candidates` are the exercises the plateau handler may swap in.
 */
export function progressExercise(
  state: ExerciseState | undefined,
  exercise: ProgressionExercise,
  slot: SlotScheme,
  ctx: EngineContext,
  candidates: readonly ProgressionExercise[] = [],
): ExercisePrescription {
  const config = ctx.config.lift;
  const rules = config.progression;
  const loading = loadingOf(exercise, ctx);
  const reasons: Reason[] = [];
  const plateau = isPlateauActive(state, ctx.date, rules)
    ? state.plateau.action
    : null;
  const scheme =
    plateau === "rep_scheme"
      ? shiftedScheme(slot, rules.plateauRepShift)
      : slot;
  if (plateau === "rep_scheme") {
    reasons.push({
      code: "plateau_rep_scheme",
      text: `Plateau: ${scheme.repMin}–${scheme.repMax} reps instead of ${slot.repMin}–${slot.repMax} for a block.`,
    });
  }
  const last = state?.exposures.at(-1);
  const target = last?.target ?? null;
  const base: ExercisePrescription = {
    load: null,
    band: null,
    sets: scheme.sets,
    repMin: scheme.repMin,
    repMax: scheme.repMax,
    targetRir: scheme.targetRir,
    backOff: null,
    swapTo: null,
    reasons,
  };

  let item: ExercisePrescription;
  if (!state || !last) {
    reasons.push({
      code: "no_history",
      text: `No history yet: pick a weight you could lift for ${scheme.repMin}–${scheme.repMax} reps${scheme.targetRir === null ? "" : ` with ${scheme.targetRir} in reserve`}.`,
    });
    item = base;
  } else if (state.lastOutcome === "missed" && target !== null) {
    const lastLoad = lastWorkingLoad(last, target, exercise, loading, ctx);
    reasons.push({
      code: "hold_after_miss",
      text: `Missed ${target.repMin} reps last time (${last.date}), so the same weight and effort again.`,
    });
    item = {
      ...base,
      load: lastLoad && loadable(lastLoad, loading, ctx),
      band: target.band,
      targetRir: target.targetRir,
    };
  } else if (
    modelOf(exercise) === "e1rm_rir" &&
    loading.kind === "weight" &&
    state.e1rm !== null
  ) {
    item = e1rmPrescription(
      { ...state, e1rm: state.e1rm },
      base,
      target,
      loading,
      ctx,
    );
  } else {
    item = doubleProgression(state, exercise, base, slot, loading, ctx);
  }

  if (state && isCalibrating(state, ctx.date, config)) {
    item.reasons.push({
      code: "calibrating",
      text: "Calibrating: the first two weeks of an exercise move weights in small steps.",
    });
  }
  if (plateau === "variation") {
    const swap = variationFor(exercise, candidates);
    if (swap) {
      item.swapTo = swap.id;
      item.reasons.push({
        code: "plateau_variation",
        text: `Plateau: ${swap.name} in place of ${exercise.name} for a block.`,
      });
    }
  }
  if (plateau === "back_off" || (plateau === "variation" && !item.swapTo)) {
    item.backOff = {
      load:
        item.load &&
        (loading.kind === "weight"
          ? {
              value:
                roundToLoadable(
                  ctx.equipment,
                  loading.implement,
                  item.load.value * rules.backOffLoad,
                ) ?? item.load.value,
              unit: item.load.unit,
            }
          : item.load),
      band: item.band && (bandStep(item.band, -1, ctx) ?? item.band),
      reps: item.repMax,
    };
    item.reasons.push({
      code: "plateau_back_off",
      text: `Plateau: one lighter back-off set of ${item.repMax} after the working sets for a block.`,
    });
  }
  return item;
}

function e1rmPrescription(
  state: ExerciseState & { e1rm: Weight },
  base: ExercisePrescription,
  target: LiftTarget | null,
  loading: Loading & { kind: "weight" },
  ctx: EngineContext,
): ExercisePrescription {
  const { reasons } = base;
  const rir = base.targetRir ?? 0;
  const e1rm = toWeightUnit(state.e1rm, ctx.weightUnit);
  const raw = loadFor(e1rm, base.repMin, rir);
  const overMax =
    roundToLoadable(ctx.equipment, loading.implement, raw, "up") === null;
  let value = roundDownToLoadable(ctx.equipment, loading.implement, raw);
  if (value === null) {
    reasons.push({
      code: "not_loadable",
      text: "Your equipment can't make a weight for this; pick one you can load.",
    });
    return base;
  }
  const item: ExercisePrescription = {
    ...base,
    load: { value, unit: ctx.weightUnit },
  };
  reasons.push({
    code: "from_e1rm",
    text: `${fmt(item.load!)} for ${base.repMin} reps at ${rir} RIR from your e1RM of ${formatAmount(Math.round(e1rm), ctx.weightUnit)}.`,
  });
  if (state.lastOutcome === "stalled" && target?.load) {
    const held = toWeightUnit(target.load, ctx.weightUnit);
    if (value > held + EPSILON) value = held;
    item.load = { value, unit: ctx.weightUnit };
    reasons.push({
      code: "stall",
      text: `Second miss in a row: the weight comes from your lowered e1RM, no heavier than last time.`,
    });
  }
  if (overMax) {
    const max = ctx.config.lift.maxRepsPlusRir - rir;
    const reps = Math.max(
      base.repMin,
      Math.min(max, Math.floor(30 * (e1rm / value - 1) - rir)),
    );
    item.repMin = reps;
    item.repMax = Math.max(base.repMax, reps);
    reasons.push({
      code: "max_load",
      text: `${fmt(item.load!)} is your heaviest, so progress by reps: ${reps} at ${rir} RIR.`,
    });
  }
  return item;
}

function doubleProgression(
  state: ExerciseState,
  exercise: ProgressionExercise,
  base: ExercisePrescription,
  slot: SlotScheme,
  loading: Loading,
  ctx: EngineContext,
): ExercisePrescription {
  const rules = ctx.config.lift.progression;
  const { reasons } = base;
  const last = state.exposures.at(-1)!;
  const target = last.target ?? null;
  const top = topSet(last.sets);
  const lastLoad = lastWorkingLoad(last, target, exercise, loading, ctx);
  const loadFromFallback = target === null || target.load === null;
  const lastBand = target ? target.band : (top?.band ?? null);
  // Extra reps or sets from a step that was too big carry over until it's taken.
  const extended =
    target !== null && target.repMin === base.repMin
      ? {
          sets: Math.min(
            Math.max(base.sets, target.sets),
            slot.sets + rules.maxExtraSets,
          ),
          repMax: Math.min(
            Math.max(base.repMax, target.repMax),
            slot.repMax + rules.maxExtraReps,
          ),
        }
      : { sets: base.sets, repMax: base.repMax };
  const held: ExercisePrescription = {
    ...base,
    ...extended,
    load: lastLoad && loadable(lastLoad, loading, ctx),
    band: lastBand,
  };
  const what = (load: Weight | null, band: string | null) =>
    load ? fmt(load) : (band ?? "bodyweight");

  if (state.lastOutcome === "stalled") {
    reasons.push({
      code: "cut_after_stall",
      text: `Second miss in a row: lighter for a fresh run at ${base.repMin}–${base.repMax} reps.`,
    });
    return {
      ...held,
      ...{ sets: base.sets, repMax: base.repMax },
      load: lastLoad && cutLoad(lastLoad, rules.cut, loading, ctx),
      band: lastBand && (bandStep(lastBand, -1, ctx) ?? lastBand),
    };
  }
  if (state.lastOutcome !== "top" && state.lastOutcome !== "beat") {
    reasons.push({
      code: target ? "build_reps" : "repeat_last",
      text: target
        ? `Same weight until every set reaches ${held.repMax} reps${held.targetRir === null ? "" : ` at ${held.targetRir} RIR or easier`}.`
        : `Same as last time (${last.date}): ${what(held.load, held.band)}.`,
    });
    return held;
  }

  const beat = state.lastOutcome === "beat";
  let next: { load: Weight | null; band: string | null } | null = null;
  if (loading.kind === "band" && lastBand) {
    const band =
      bandStep(lastBand, beat ? 2 : 1, ctx) ?? bandStep(lastBand, 1, ctx);
    next = band === null ? null : { load: null, band };
  } else if (
    lastLoad &&
    (!loadFromFallback || allSetsAtLoad(last.sets, lastLoad, ctx.weightUnit))
  ) {
    const from = toWeightUnit(lastLoad, ctx.weightUnit);
    let load = stepUp(lastLoad, beat ? 2 : 1, exercise, loading, ctx);
    if (
      beat &&
      load &&
      load.value > from * (1 + rules.maxDoubleRise) + EPSILON
    ) {
      load = stepUp(lastLoad, 1, exercise, loading, ctx);
    }
    const tooBig =
      load !== null && load.value - from > from * rules.maxJump + EPSILON;
    if (load && !tooBig) next = { load, band: null };
    else if (load && tooBig && !canExtend(held, slot, rules)) {
      next = { load, band: null };
    }
  }

  if (next) {
    reasons.push({
      code: beat ? "double_increase" : "increase",
      text: `Hit ${held.repMax} reps on every set, so up to ${what(next.load, next.band)} and back toward ${base.repMin} reps.`,
    });
    return { ...base, ...next };
  }
  if (
    loadFromFallback &&
    lastLoad &&
    !allSetsAtLoad(last.sets, lastLoad, ctx.weightUnit)
  ) {
    reasons.push({
      code: "repeat_last",
      text: `Mixed working-set loads last time, so hold the same load and repeat ${base.sets} sets of ${base.repMin}–${base.repMax} reps.`,
    });
    return { ...base, load: held.load, band: held.band };
  }
  if (canExtend(held, slot, rules)) {
    const repMax = held.repMax + rules.extraRepsStep;
    if (repMax <= slot.repMax + rules.maxExtraReps) {
      reasons.push({
        code: "progress_reps",
        text: `The next weight is too big a jump, so aim for ${repMax} reps first.`,
      });
      return { ...held, repMax };
    }
    reasons.push({
      code: "progress_sets",
      text: `The next weight is too big a jump, so add a set first.`,
    });
    return { ...held, sets: held.sets + 1 };
  }
  reasons.push({
    code: "harder_variation",
    text: `${what(held.load, held.band)} is as heavy as your equipment goes; try a harder variation, such as a single-arm or single-leg one.`,
  });
  return held;
}

const canExtend = (
  held: Pick<LiftTarget, "sets" | "repMax">,
  slot: SlotScheme,
  rules: Progression,
) =>
  held.repMax + rules.extraRepsStep <= slot.repMax + rules.maxExtraReps ||
  held.sets < slot.sets + rules.maxExtraSets;

function variationFor(
  exercise: ProgressionExercise,
  candidates: readonly ProgressionExercise[],
): ProgressionExercise | null {
  if (exercise.substitutionGroup === null) return null;
  const options = candidates
    .filter(
      (c) =>
        c.id !== exercise.id &&
        c.substitutionGroup === exercise.substitutionGroup,
    )
    .sort(
      (a, b) =>
        equipmentRank(a) - equipmentRank(b) || a.name.localeCompare(b.name),
    );
  return options[0] ?? null;
}
