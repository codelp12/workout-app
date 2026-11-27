import {
  addDays,
  type Exercise,
  type Onboarding,
  type Weight,
} from "@workout-app/shared";
import type { EngineConfig } from "../config.js";
import type { LiftSessionLog } from "../stubs/lift.js";
import { toWeightUnit } from "../units.js";
import { initLiftEngineState, updateLiftEngineState } from "./state.js";

export type LiftReviewInput = {
  weekStart: string;
  onboarding: Onboarding | null;
  logs: readonly LiftSessionLog[];
  exercises: readonly Pick<Exercise, "id" | "name" | "primaryMuscles">[];
  planned: readonly {
    date: string;
    exerciseId: string;
    targets: Record<string, unknown>;
    reasons: string[];
  }[];
  config: EngineConfig["lift"];
};

export type LiftReview = {
  exercises: {
    exerciseId: string;
    name: string;
    topSet: { load: Weight | null; band: string | null; reps: number };
    workingSets: number;
    totalReps: number;
    e1rmBefore: Weight | null;
    e1rmAfter: Weight | null;
    e1rmChange: Weight | null;
    thisWeek: { targets: Record<string, unknown>; reasons: string[] } | null;
  }[];
  muscles: { muscle: string; hardSets: number; cap: number }[];
};

const lastWeekStart = (weekStart: string) => addDays(weekStart, -7);

export function reviewLiftWeek(input: LiftReviewInput): LiftReview {
  const from = lastWeekStart(input.weekStart);
  const through = addDays(input.weekStart, -1);
  const orderedLogs = [...input.logs].sort((a, b) =>
    a.session.localDate.localeCompare(b.session.localDate),
  );
  const beforeLogs = orderedLogs.filter((log) => log.session.localDate < from);
  const lastWeekLogs = orderedLogs.filter(
    (log) => log.session.localDate >= from && log.session.localDate <= through,
  );
  const setsByExercise = new Map<string, LiftSessionLog["sets"][number][]>();
  for (const log of lastWeekLogs) {
    for (const set of log.sets) {
      if (set.isWarmup) continue;
      setsByExercise.set(set.exerciseId, [
        ...(setsByExercise.get(set.exerciseId) ?? []),
        set,
      ]);
    }
  }

  let beforeState = initLiftEngineState(input.onboarding, input.config);
  for (const log of beforeLogs) {
    beforeState = updateLiftEngineState(beforeState, log, input.config);
  }
  let afterState = beforeState;
  for (const log of lastWeekLogs) {
    afterState = updateLiftEngineState(afterState, log, input.config);
  }

  const exerciseById = new Map(input.exercises.map((e) => [e.id, e]));
  const plannedByExercise = (exerciseId: string) => {
    let earliest: LiftReviewInput["planned"][number] | undefined;
    for (const item of input.planned) {
      if (
        item.exerciseId === exerciseId &&
        (!earliest || item.date < earliest.date)
      ) {
        earliest = item;
      }
    }
    return earliest
      ? { targets: { ...earliest.targets }, reasons: [...earliest.reasons] }
      : null;
  };

  const muscles = new Map<string, number>();
  for (const [exerciseId, sets] of setsByExercise) {
    for (const muscle of new Set(
      exerciseById.get(exerciseId)?.primaryMuscles ?? [],
    )) {
      muscles.set(muscle, (muscles.get(muscle) ?? 0) + sets.length);
    }
  }

  const exercises = [...setsByExercise].map(([exerciseId, sets]) => {
    const loaded = sets.filter(
      (set) => set.loadValue !== null && set.loadUnit !== null,
    );
    const topSet = [...(loaded.length > 0 ? loaded : sets)].sort((a, b) => {
      if (loaded.length === 0) return b.reps - a.reps;
      const aLoad = toWeightUnit(
        { value: a.loadValue!, unit: a.loadUnit! },
        "lb",
      );
      const bLoad = toWeightUnit(
        { value: b.loadValue!, unit: b.loadUnit! },
        "lb",
      );
      return Math.abs(bLoad - aLoad) > 1e-9 ? bLoad - aLoad : b.reps - a.reps;
    })[0]!;
    const before = beforeState.exercises[exerciseId]?.e1rm ?? null;
    const after = afterState.exercises[exerciseId]?.e1rm ?? null;
    const e1rmChange =
      before && after
        ? {
            value: after.value - toWeightUnit(before, after.unit),
            unit: after.unit,
          }
        : null;
    const load =
      topSet.loadValue === null || topSet.loadUnit === null
        ? null
        : { value: topSet.loadValue, unit: topSet.loadUnit };
    return {
      exerciseId,
      name: exerciseById.get(exerciseId)?.name ?? exerciseId,
      topSet: { load, band: topSet.band, reps: topSet.reps },
      workingSets: sets.length,
      totalReps: sets.reduce((sum, set) => sum + set.reps, 0),
      e1rmBefore: before,
      e1rmAfter: after,
      e1rmChange,
      thisWeek: plannedByExercise(exerciseId),
    };
  });

  return {
    exercises: exercises.sort((a, b) => a.name.localeCompare(b.name)),
    muscles: [...muscles]
      .map(([muscle, hardSets]) => ({
        muscle,
        hardSets,
        cap: input.config.block.hardSetCap,
      }))
      .sort(
        (a, b) => b.hardSets - a.hardSets || a.muscle.localeCompare(b.muscle),
      ),
  };
}
