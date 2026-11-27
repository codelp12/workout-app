import type {
  Exercise,
  Equipment,
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
  deload?: true;
  /** What the plan asked for, when the session was planned. */
  target?: LiftTarget | null;
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
  /** Ramp slots only: sets the block's ramp has added over the template this week. */
  rampSets?: number;
  reasons: Reason[];
};

export type LiftPrescription = { items: LiftItem[]; reasons: Reason[] };

/** The part of a planned item a logged exposure is judged against. */
export type LiftTarget = Pick<
  LiftItem,
  "load" | "band" | "sets" | "repMin" | "repMax" | "targetRir" | "rampSets"
>;

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
  /** Each exercise's planned targets, by exercise id, when it was planned. */
  targets?: Readonly<Record<string, LiftTarget>>;
};

// Equipment-first selection (SPEC §5.1): dumbbell, band, then bodyweight.
const PREFERENCE = ["dumbbell", "band", "bodyweight"];
const EQUIPMENT_WORDS = new Set([
  "barbell",
  "dumbbell",
  "cable",
  "machine",
  "band",
  "bands",
]);

function nameSimilarity(a: string, b: string): number {
  const words = (name: string) =>
    new Set(
      name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 0 && !EQUIPMENT_WORDS.has(word)),
    );
  const left = words(a);
  const right = words(b);
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  const intersection = [...left].filter((word) => right.has(word)).length;
  return intersection / union.size;
}

/** Lower is preferred: dumbbell, band, bodyweight, then anything else (SPEC §5.1). */
export const equipmentRank = (exercise: Pick<LiftExercise, "equipment">) => {
  const best = Math.min(
    ...exercise.equipment.map((e) =>
      PREFERENCE.includes(e) ? PREFERENCE.indexOf(e) : PREFERENCE.length,
    ),
  );
  return Number.isFinite(best) ? best : PREFERENCE.length;
};

/** Lower is preferred: owned dumbbell, band, bodyweight, then other equipment. */
function ownedRank(
  exercise: Pick<LiftExercise, "equipment">,
  equipment: Equipment,
) {
  const rank = exercise.equipment.reduce(
    (best, kind) =>
      (kind === "dumbbell" && equipment.dumbbells !== null) ||
      (kind === "band" && equipment.bands.length > 0) ||
      kind === "bodyweight"
        ? Math.min(best, PREFERENCE.indexOf(kind))
        : best,
    PREFERENCE.length,
  );
  return rank;
}

function keepsOwnExercise(slot: TemplateSlot, exercise: LiftExercise) {
  return (
    slot.pinned ||
    exercise.substitutionGroup === null ||
    !exercise.equipment.some((kind) =>
      ["barbell", "cable", "machine"].includes(kind),
    )
  );
}

function explicitCandidates(
  exercise: LiftExercise,
  exercises: readonly LiftExercise[],
  equipment: Equipment,
) {
  return exercises
    .filter(
      (candidate) =>
        candidate.substitutionGroup === exercise.substitutionGroup &&
        candidate.id !== exercise.id &&
        !candidate.equipment.some((kind) =>
          ["barbell", "cable", "machine"].includes(kind),
        ) &&
        ownedRank(candidate, equipment) <= 1,
    )
    .sort(
      (a, b) =>
        ownedRank(a, equipment) - ownedRank(b, equipment) ||
        nameSimilarity(b.name, exercise.name) -
          nameSimilarity(a.name, exercise.name) ||
        a.name.localeCompare(b.name),
    );
}

function groupCandidates(
  slot: TemplateSlot,
  exercises: readonly LiftExercise[],
  equipment: Equipment,
) {
  return exercises
    .filter((e) => e.substitutionGroup === slot.substitutionGroup)
    .sort(
      (a, b) =>
        ownedRank(a, equipment) - ownedRank(b, equipment) ||
        a.name.localeCompare(b.name),
    );
}

export function slotReasons(
  slot: TemplateSlot,
  exercise: LiftExercise | null,
  exercises: readonly LiftExercise[],
): Reason[] {
  if (exercise === null) {
    return [
      {
        code: "no_exercise",
        text: `No exercise in the ${slot.substitutionGroup ?? "slot's"} group; pick one.`,
      },
    ];
  }
  if (slot.exerciseId === null) {
    return [
      {
        code: "substituted",
        text: `${exercise.name} fills the ${slot.substitutionGroup ?? ""} slot with your equipment.`,
      },
    ];
  }
  if (exercise.id === slot.exerciseId) return [];
  const original = exercises.find((e) => e.id === slot.exerciseId)!;
  const kind = exercise.equipment.includes("dumbbell") ? "dumbbells" : "bands";
  return [
    {
      code: "substituted",
      text: `${exercise.name} replaces ${original.name} so you can use your ${kind}. Turn on "Keep this exercise" in the template to keep ${original.name}.`,
    },
  ];
}

/** Resolves all slots together so substitutions don't duplicate exercises. */
export function resolveSlots(
  slots: readonly TemplateSlot[],
  exercises: readonly LiftExercise[],
  equipment: Equipment,
): (LiftExercise | null)[] {
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const originals = slots.map((slot) =>
    slot.exerciseId === null ? null : (byId.get(slot.exerciseId) ?? null),
  );
  const swappable = slots.map((slot, index) => {
    const exercise = originals[index];
    return (
      exercise !== null &&
      exercise !== undefined &&
      !keepsOwnExercise(slot, exercise)
    );
  });
  const used = new Set<string>();
  slots.forEach((slot, index) => {
    const exercise = originals[index];
    if (slot.exerciseId !== null && exercise && !swappable[index]) {
      used.add(exercise.id);
    }
  });
  return slots.map((slot, index) => {
    const exercise = originals[index];
    if (slot.exerciseId !== null) {
      if (!exercise) return null;
      const resolved = swappable[index]
        ? (explicitCandidates(exercise, exercises, equipment).find(
            (candidate) => !used.has(candidate.id),
          ) ?? exercise)
        : exercise;
      used.add(resolved.id);
      return resolved;
    }
    const candidates = groupCandidates(slot, exercises, equipment);
    const resolved =
      candidates.find((candidate) => !used.has(candidate.id)) ??
      candidates[0] ??
      null;
    if (resolved) used.add(resolved.id);
    return resolved;
  });
}

/** How an exercise is loaded by weight, or null for bands and bodyweight. */
export function implementOf(
  exercise: LiftExercise | null,
): WeightImplement | null {
  const equipment = exercise?.equipment ?? [];
  if (equipment.includes("dumbbell")) return "dumbbell";
  if (equipment.includes("barbell")) return "barbell";
  if (equipment.includes("cable") || equipment.includes("machine")) {
    return "stack";
  }
  return null;
}

export const topSet = (sets: readonly LiftSet[]) =>
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
  exercise: LiftExercise | null,
  exercises: readonly LiftExercise[],
  ctx: EngineContext,
): LiftItem {
  const reasons = slotReasons(slot, exercise, exercises);
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
  if (exercise === null) return item;
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
  prescribe: (state, intent, ctx) => {
    const resolved = resolveSlots(
      intent.slots,
      intent.exercises,
      ctx.equipment,
    );
    return {
      items: intent.slots.map((slot, index) =>
        prescribeSlot(
          state,
          slot,
          resolved[index] ?? null,
          intent.exercises,
          ctx,
        ),
      ),
      reasons: [
        {
          code: "static_template",
          text: `${intent.name} as written; progression arrives with the lifting engine.`,
        },
      ],
    };
  },
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
