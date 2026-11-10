import type {
  Exercise,
  Onboarding,
  SessionLog,
  SetLog,
  TemplateSlot,
  Weight,
} from "@workout-app/shared";
import { roundToLoadable, type WeightImplement } from "../loads.js";
import type { EngineContext, ModalityEngine, Reason } from "../types.js";
import { formatAmount, toWeightUnit } from "../units.js";

export type LiftExercise = Pick<
  Exercise,
  "id" | "name" | "equipment" | "substitutionGroup"
>;

/** A template to prescribe, with the exercises its slots can resolve to. */
export type LiftIntent = {
  name: string;
  slots: readonly TemplateSlot[];
  exercises: readonly LiftExercise[];
};

export type LiftSet = {
  /** Null for bodyweight or band sets. */
  load: Weight | null;
  band: string | null;
  reps: number;
  rir: number | null;
};

/** The working sets of an exercise's latest exposure. */
export type LiftExposure = {
  date: string;
  source: "log" | "onboarding";
  sets: LiftSet[];
};

export type LiftState = { exposures: Record<string, LiftExposure> };

export type LiftItem = {
  /** Null when the slot's substitution group has no exercise to offer. */
  exerciseId: string | null;
  sets: number;
  /** In the context's weight unit and loadable; null when there's nothing to prefill. */
  load: Weight | null;
  band: string | null;
  repMin: number;
  repMax: number;
  targetRir: number | null;
  restSec: number;
  /** Whether the first exercise of a movement pattern ramps up with warm-ups. */
  ramp?: boolean;
  reasons: Reason[];
};

export type LiftPrescription = { items: LiftItem[]; reasons: Reason[] };

export type LiftSessionLog = {
  session: Pick<SessionLog, "localDate">;
  sets: readonly Pick<
    SetLog,
    | "exerciseId"
    | "index"
    | "loadValue"
    | "loadUnit"
    | "band"
    | "reps"
    | "rir"
    | "isWarmup"
  >[];
};

// Equipment-first selection (SPEC §5.1): dumbbell, band, then bodyweight.
const PREFERENCE = ["dumbbell", "band", "bodyweight"];

/** Lower is preferred: dumbbell, band, bodyweight, then anything else (SPEC §5.1). */
export const equipmentRank = (exercise: Pick<LiftExercise, "equipment">) => {
  const best = Math.min(
    ...exercise.equipment.map((e) =>
      PREFERENCE.includes(e) ? PREFERENCE.indexOf(e) : PREFERENCE.length,
    ),
  );
  return Number.isFinite(best) ? best : PREFERENCE.length;
};

function resolve(
  slot: TemplateSlot,
  exercises: readonly LiftExercise[],
): LiftExercise | null {
  if (slot.exerciseId !== null) {
    return exercises.find((e) => e.id === slot.exerciseId) ?? null;
  }
  const group = exercises.filter(
    (e) => e.substitutionGroup === slot.substitutionGroup,
  );
  return group.reduce<LiftExercise | null>(
    (best, e) =>
      best === null || equipmentRank(e) < equipmentRank(best) ? e : best,
    null,
  );
}

function implementOf(exercise: LiftExercise | null): WeightImplement | null {
  const equipment = exercise?.equipment ?? [];
  if (equipment.includes("dumbbell")) return "dumbbell";
  if (equipment.includes("barbell")) return "barbell";
  if (equipment.includes("cable") || equipment.includes("machine")) {
    return "stack";
  }
  return null;
}

const topSet = (sets: readonly LiftSet[]) =>
  sets.reduce<LiftSet | null>(
    (top, s) =>
      top === null || (s.load?.value ?? -1) > (top.load?.value ?? -1) ? s : top,
    null,
  );

function describe(set: LiftSet): string {
  const what = set.load
    ? formatAmount(set.load.value, set.load.unit)
    : (set.band ?? "bodyweight");
  return `${what} × ${set.reps}${set.rir === null ? "" : ` at ${set.rir} RIR`}`;
}

function prefillLoad(
  exercise: LiftExercise | null,
  last: LiftSet,
  ctx: EngineContext,
  reasons: Reason[],
): Weight | null {
  if (last.load === null) return null;
  const target = toWeightUnit(last.load, ctx.weightUnit);
  const implement = implementOf(exercise);
  const value =
    implement === null
      ? target
      : (roundToLoadable(ctx.equipment, implement, target) ??
        (implement === "barbell" && ctx.equipment.bar !== null
          ? roundToLoadable(ctx.equipment, "bar", target)
          : null));
  if (value === null) {
    reasons.push({
      code: "not_loadable",
      text: "Your equipment can't make that weight; pick one you can load.",
    });
    return null;
  }
  if (Math.abs(value - target) > 1e-9) {
    reasons.push({
      code: "rounded",
      text: `Rounded ${formatAmount(target, ctx.weightUnit)} to ${formatAmount(value, ctx.weightUnit)}, the nearest you can load.`,
    });
  }
  return { value, unit: ctx.weightUnit };
}

function prescribeSlot(
  state: LiftState,
  slot: TemplateSlot,
  exercises: readonly LiftExercise[],
  ctx: EngineContext,
): LiftItem {
  const exercise = resolve(slot, exercises);
  const reasons: Reason[] = [];
  const item: LiftItem = {
    exerciseId: exercise?.id ?? null,
    sets: slot.sets,
    load: null,
    band: null,
    repMin: slot.repMin,
    repMax: slot.repMax,
    targetRir: slot.targetRir,
    restSec: slot.restSec,
    ramp: slot.ramp,
    reasons,
  };
  if (exercise === null) {
    reasons.push({
      code: "no_exercise",
      text: `No exercise in the ${slot.substitutionGroup ?? "slot's"} group; pick one.`,
    });
    return item;
  }
  if (slot.exerciseId === null) {
    reasons.push({
      code: "substituted",
      text: `${exercise.name} fills the ${slot.substitutionGroup ?? ""} slot with your equipment.`,
    });
  }
  const exposure = state.exposures[exercise.id];
  const last = exposure && topSet(exposure.sets);
  if (!exposure || !last) {
    reasons.push({
      code: "no_history",
      text: `No history yet: pick a weight you could lift for ${slot.repMin}–${slot.repMax} reps${slot.targetRir === null ? "" : ` with ${slot.targetRir} in reserve`}.`,
    });
    return item;
  }
  reasons.unshift(
    exposure.source === "onboarding"
      ? {
          code: "from_setup",
          text: `From your setup answers: ${describe(last)}.`,
        }
      : {
          code: "repeat_last",
          text: `Same as last time (${exposure.date}): ${describe(last)}.`,
        },
  );
  item.band = last.band;
  item.load = prefillLoad(exercise, last, ctx, reasons);
  return item;
}

function initState(onboarding: Onboarding | null): LiftState {
  const exposures: Record<string, LiftExposure> = {};
  for (const lift of onboarding?.lifts ?? []) {
    exposures[lift.exerciseId] = {
      date: "",
      source: "onboarding",
      sets: [{ load: lift.load, band: null, reps: lift.reps, rir: lift.rir }],
    };
  }
  return { exposures };
}

function update(state: LiftState, log: LiftSessionLog): LiftState {
  const byExercise = new Map<string, LiftSessionLog["sets"][number][]>();
  for (const set of log.sets) {
    if (set.isWarmup) continue;
    byExercise.set(set.exerciseId, [
      ...(byExercise.get(set.exerciseId) ?? []),
      set,
    ]);
  }
  const exposures = { ...state.exposures };
  for (const [exerciseId, sets] of byExercise) {
    const previous = exposures[exerciseId];
    if (previous?.source === "log" && previous.date > log.session.localDate) {
      continue;
    }
    exposures[exerciseId] = {
      date: log.session.localDate,
      source: "log",
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
    };
  }
  return { exposures };
}

/** Phase 1 lifting stub: the template as written, loads prefilled from last time. */
export const liftStub: ModalityEngine<
  LiftState,
  LiftIntent,
  LiftPrescription,
  LiftSessionLog
> = {
  modality: "lift",
  version: "stub-1",
  initState,
  prescribe: (state, intent, ctx) => ({
    items: intent.slots.map((slot) =>
      prescribeSlot(state, slot, intent.exercises, ctx),
    ),
    reasons: [
      {
        code: "static_template",
        text: `${intent.name} as written; progression arrives with the lifting engine.`,
      },
    ],
  }),
  update,
  reviewWeek: (_state, logs) => ({
    reasons: [
      {
        code: "sessions_logged",
        text: `${logs.length} lifting ${logs.length === 1 ? "session" : "sessions"} logged.`,
      },
    ],
  }),
};
