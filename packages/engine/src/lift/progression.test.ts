import {
  addDays,
  DEFAULT_EQUIPMENT,
  type Equipment,
} from "@workout-app/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ENGINE_CONFIG } from "../config.js";
import { isLoadable } from "../loads.js";
import type { LiftSessionLog, LiftTarget } from "../stubs/lift.js";
import type { EngineContext } from "../types.js";
import {
  progressExercise,
  type ProgressionExercise,
  type SlotScheme,
} from "./progression.js";
import {
  judgeExposure,
  updateLiftEngineState,
  type ExerciseState,
} from "./state.js";

const config = ENGINE_CONFIG.lift;

const ctx = (
  equipment: Equipment = DEFAULT_EQUIPMENT,
  date = "2026-12-01",
): EngineContext => ({
  date,
  weekType: "loading",
  readiness: "green",
  weightUnit: "lb",
  distanceUnit: "mi",
  equipment,
  config: ENGINE_CONFIG,
});

const curl: ProgressionExercise = {
  id: "curl",
  name: "Dumbbell curl",
  equipment: ["dumbbell"],
  substitutionGroup: "curl:biceps",
  progressionModel: "double_progression",
  increment: null,
};
const bench: ProgressionExercise = {
  ...curl,
  id: "bench",
  name: "Dumbbell bench press",
  substitutionGroup: "horizontal_push:chest",
  progressionModel: "e1rm_rir",
};
const pullApart: ProgressionExercise = {
  ...curl,
  id: "pull-apart",
  name: "Band pull-apart",
  equipment: ["band"],
};

const accessory: SlotScheme = { sets: 3, repMin: 8, repMax: 12, targetRir: 2 };
const main: SlotScheme = { sets: 3, repMin: 6, repMax: 8, targetRir: 2 };

const target = (
  load: number | null,
  fields: Partial<LiftTarget> = {},
): LiftTarget => ({
  load: load === null ? null : { value: load, unit: "lb" },
  band: null,
  ...accessory,
  ...fields,
});

/** One planned session: `sets` are `[load, reps, rir]`, or `[band, reps, rir]`. */
type Session = {
  target: LiftTarget;
  sets: [number | string | null, number, number | null][];
  loadUnit?: "lb" | "kg";
};

const session = (
  exerciseId: string,
  date: string,
  { target: t, sets, loadUnit = "lb" }: Session,
): LiftSessionLog => ({
  session: { localDate: date },
  targets: { [exerciseId]: t },
  sets: sets.map(([load, reps, rir], index) => ({
    exerciseId,
    index,
    loadValue: typeof load === "number" ? load : null,
    loadUnit: typeof load === "number" ? loadUnit : null,
    band: typeof load === "string" ? load : null,
    reps,
    rir,
    isWarmup: false,
  })),
});

/** Folds the sessions a week apart, after calibration has ended. */
function history(exerciseId: string, ...sessions: Session[]): ExerciseState {
  let state = updateLiftEngineState(
    { exercises: {} },
    {
      session: { localDate: "2026-10-01" },
      sets: [
        {
          exerciseId,
          index: 0,
          loadValue: null,
          loadUnit: null,
          band: null,
          reps: 1,
          rir: null,
          isWarmup: false,
        },
      ],
    },
    config,
  );
  sessions.forEach((s, i) => {
    const date = addDays("2026-11-02", i - sessions.length + 1);
    state = updateLiftEngineState(state, session(exerciseId, date, s), config);
  });
  return state.exercises[exerciseId]!;
}

const sets = (
  n: number,
  load: number | string | null,
  reps: number,
  rir: number | null = 2,
): Session["sets"] => Array.from({ length: n }, () => [load, reps, rir]);

const met = (load: number, fields: Partial<LiftTarget> = {}): Session => {
  const t = target(load, fields);
  return { target: t, sets: sets(t.sets, load, t.repMax, t.targetRir) };
};
const missed = (load: number, fields: Partial<LiftTarget> = {}): Session => {
  const t = target(load, fields);
  return { target: t, sets: sets(t.sets, load, t.repMin - 2, 0) };
};

describe("judgeExposure", () => {
  const t = target(25);
  it.each([
    ["missed", sets(3, 25, 6), 0],
    ["done", sets(3, 25, 7), 1],
    ["done", sets(3, 25, 10), 0],
    ["top", sets(3, 25, 12), 0],
    ["done", sets(2, 25, 12), 0],
    ["done", sets(3, 25, 12, 1), 0],
    ["done", sets(3, 25, 12, null), 0],
    ["beat", sets(3, 25, 13), 0],
    ["beat", sets(3, 25, 12, 4), 0],
    [null, sets(3, 20, 6), 0],
    ["top", sets(3, 30, 12), 0],
  ] as const)("%s for %j with %i reps of slack", (outcome, s, slack) => {
    const logged = s.map(([load, reps, rir]) => ({
      load:
        typeof load === "number" ? { value: load, unit: "lb" as const } : null,
      band: null,
      reps,
      rir,
    }));
    expect(judgeExposure(logged, t, slack, config)).toBe(outcome);
  });
});

describe("miss, stall and plateau bookkeeping", () => {
  it("counts misses and stalls, and a top set resets the stall count", () => {
    expect(history("curl", missed(25))).toMatchObject({
      lastOutcome: "missed",
      missStreak: 1,
      stallCount: 0,
    });
    expect(history("curl", missed(25), missed(25))).toMatchObject({
      lastOutcome: "stalled",
      missStreak: 0,
      stallCount: 1,
    });
    expect(history("curl", missed(25), missed(25), met(25))).toMatchObject({
      lastOutcome: "top",
      stallCount: 0,
    });
  });

  it("starts the plateau handler on the third stall, rotating fixes", () => {
    const stalls = (n: number) =>
      Array.from({ length: n * 2 }, () => missed(25));
    expect(history("curl", ...stalls(2)).plateau).toBeNull();
    expect(history("curl", ...stalls(3))).toMatchObject({
      plateau: { action: "rep_scheme" },
      plateaus: 1,
      stallCount: 0,
    });
    expect(history("curl", ...stalls(6)).plateau?.action).toBe("back_off");
    expect(history("curl", ...stalls(9)).plateau?.action).toBe("variation");
  });

  it("gives a rep of slack during calibration", () => {
    let state = updateLiftEngineState(
      { exercises: {} },
      session("curl", "2026-11-02", {
        target: target(25),
        sets: sets(3, 25, 7, 0),
      }),
      config,
    );
    expect(state.exercises.curl?.lastOutcome).toBe("done");
    state = updateLiftEngineState(
      state,
      session("curl", "2026-11-20", {
        target: target(25),
        sets: sets(3, 25, 7, 0),
      }),
      config,
    );
    expect(state.exercises.curl?.lastOutcome).toBe("missed");
  });
});

describe("double_progression", () => {
  const prescribe = (
    state: ExerciseState | undefined,
    exercise = curl,
    equipment?: Equipment,
  ) => progressExercise(state, exercise, accessory, ctx(equipment));

  it.each([
    ["no history", undefined, null, "no_history"],
    ["top of the range", history("curl", met(25)), 30, "increase"],
    [
      "inside the range",
      history("curl", { target: target(25), sets: sets(3, 25, 10) }),
      25,
      "build_reps",
    ],
    ["a miss", history("curl", missed(25)), 25, "hold_after_miss"],
    [
      "a second miss",
      history("curl", missed(25), missed(25)),
      20,
      "cut_after_stall",
    ],
    [
      "a cut at 60 lb",
      history("curl", missed(60), missed(60)),
      55,
      "cut_after_stall",
    ],
    [
      "beating it at 50 lb (+10% > 5%)",
      history("curl", { target: target(50), sets: sets(3, 50, 14) }),
      55,
      "increase",
    ],
  ] as const)("%s", (_, state, load, code) => {
    const item = prescribe(state);
    expect(item.load?.value ?? null).toBe(load);
    expect(item.reasons.map((r) => r.code)).toContain(
      code === "increase" && load === 55 ? "double_increase" : code,
    );
  });

  it("takes a double increment when it stays within 5%", () => {
    const stack = { ...DEFAULT_EQUIPMENT, stackStep: 2.5 };
    const cable = { ...curl, equipment: ["cable"] };
    const state = history("curl", {
      target: target(100),
      sets: sets(3, 100, 14),
    });
    expect(prescribe(state, cable, stack).load?.value).toBe(105);
  });

  it("drops back to the bottom of the range after an increase", () => {
    expect(prescribe(history("curl", met(25)))).toMatchObject({
      repMin: 8,
      repMax: 12,
      sets: 3,
    });
  });

  it("progresses reps, then a set, before too big a jump", () => {
    // 15 → 20 lb is +33%, over the 25% limit.
    const steps: [number, number, number, string][] = [];
    let state = history("curl", met(15));
    for (let i = 0; i < 4; i++) {
      const item = prescribe(state);
      steps.push([
        item.load!.value,
        item.repMax,
        item.sets,
        item.reasons[0]!.code,
      ]);
      state = history(
        "curl",
        met(15),
        met(item.load!.value, { repMax: item.repMax, sets: item.sets }),
      );
    }
    expect(steps).toEqual([
      [15, 14, 3, "progress_reps"],
      [15, 16, 3, "progress_reps"],
      [15, 16, 4, "progress_sets"],
      [20, 12, 3, "increase"],
    ]);
  });

  it("suggests a harder variation at the top of the rack", () => {
    const state = history("curl", met(120, { repMax: 16, sets: 4 }));
    const item = prescribe(state);
    expect(item.load?.value).toBe(120);
    expect(item.reasons.map((r) => r.code)).toContain("harder_variation");
  });

  it("uses a per-exercise increment", () => {
    const item = prescribe(history("curl", met(40)), {
      ...curl,
      increment: { value: 10, unit: "lb" },
    });
    expect(item.load?.value).toBe(50);
  });

  it("steps bands one level, or two when beaten", () => {
    const band = (b: string, reps: number) =>
      history("pull-apart", {
        target: target(null, { band: b }),
        sets: sets(3, b, reps),
      });
    expect(prescribe(band("Medium", 12), pullApart).band).toBe("Heavy");
    expect(prescribe(band("Light", 14), pullApart).band).toBe("Heavy");
    expect(prescribe(band("Extra heavy", 12), pullApart).reasons[0]?.code).toBe(
      "progress_reps",
    );
  });

  it("holds the last logged load when the planned target load is null", () => {
    const state = history("curl", {
      target: target(null),
      sets: [
        [85, 10, 2],
        [90, 10, 2],
        [80, 10, 2],
      ],
    });
    expect(prescribe(state).load).toEqual({ value: 90, unit: "lb" });
  });

  it("keeps a weighted pull-up load null when its target is null", () => {
    const weightedPullUp: ProgressionExercise = {
      ...curl,
      id: "weighted-pull-up",
      name: "Weighted pull-up",
      equipment: ["bodyweight"],
    };
    const state = history("weighted-pull-up", {
      target: target(null),
      sets: sets(3, 90, 10),
    });
    expect(prescribe(state, weightedPullUp).load).toBeNull();
  });

  it("holds a kettlebell goblet squat at its logged load after a top set", () => {
    const gobletSquat: ProgressionExercise = {
      ...curl,
      id: "goblet-squat",
      name: "Goblet squat",
      equipment: ["kettlebell"],
    };
    const state = history("goblet-squat", {
      target: target(null),
      sets: sets(3, 16, 12),
      loadUnit: "kg",
    });
    const item = progressExercise(state, gobletSquat, accessory, {
      ...ctx(),
      weightUnit: "kg",
    });
    expect(state.lastOutcome).toBe("top");
    expect(item.load).toEqual({ value: 16, unit: "kg" });
    expect(item.reasons.map((reason) => reason.code)).not.toContain("increase");
  });

  it("holds the logged load after a miss with a null target load", () => {
    const state = history("curl", {
      target: target(null),
      sets: sets(3, 90, 6, 0),
    });
    const item = prescribe(state);
    expect(item.load).toEqual({ value: 90, unit: "lb" });
    expect(item.reasons[0]?.code).toBe("hold_after_miss");
  });

  it("steps up from the last logged load when all sets reach repMax", () => {
    const exercise = { ...curl, increment: { value: 5, unit: "lb" as const } };
    const state = history("curl", {
      target: target(null),
      sets: sets(3, 90, 12),
    });
    expect(prescribe(state, exercise).load).toEqual({ value: 95, unit: "lb" });
  });

  it("holds at the heaviest logged load when null-target sets use mixed loads", () => {
    const state = history("curl", {
      target: target(null),
      sets: [
        [90, 12, 2],
        [80, 12, 2],
        [80, 12, 2],
      ],
    });
    const item = prescribe(state);
    expect(item).toMatchObject({
      load: { value: 90, unit: "lb" },
      sets: 3,
      repMin: 8,
      repMax: 12,
    });
    expect(item.reasons.map((reason) => reason.code)).toContain("repeat_last");
    expect(item.reasons.map((reason) => reason.code)).not.toContain("increase");
  });

  it("cuts the last logged load after a second miss with null targets", () => {
    const exercise = { ...curl, increment: { value: 5, unit: "lb" as const } };
    const miss = {
      target: target(null),
      sets: sets(3, 90, 6, 0),
    };
    const state = history("curl", miss, miss);
    const item = prescribe(state, exercise);
    expect(item.reasons.map((reason) => reason.code)).toContain(
      "cut_after_stall",
    );
    expect(item.load?.value).toBe(85);
  });

  it("keeps the load null when the latest exposure has no logged load", () => {
    const state = history("curl", {
      target: target(null),
      sets: sets(3, null, 10),
    });
    expect(prescribe(state).load).toBeNull();
  });
});

describe("e1rm_rir", () => {
  const withE1rm = (state: ExerciseState, value: number): ExerciseState => ({
    ...state,
    e1rm: { value, unit: "lb" },
  });
  const prescribe = (state: ExerciseState) =>
    progressExercise(state, bench, main, ctx());

  it("derives the load from e1RM for the bottom of the range", () => {
    const state = withE1rm(history("bench", met(60, main)), 80);
    // 80 / (1 + (6 + 2) / 30) = 63.2 lb
    expect(prescribe(state)).toMatchObject({
      load: { value: 60, unit: "lb" },
      repMin: 6,
      repMax: 8,
      targetRir: 2,
    });
    expect(prescribe(state).reasons[0]?.code).toBe("from_e1rm");
  });

  it("holds the load and RIR after a miss, overriding e1RM and the RIR step", () => {
    const state = withE1rm(history("bench", missed(60, main)), 100);
    const item = progressExercise(
      state,
      bench,
      { ...main, targetRir: 1 },
      ctx(),
    );
    expect(item.load?.value).toBe(60);
    expect(item.targetRir).toBe(2);
    expect(item.reasons[0]?.code).toBe("hold_after_miss");
  });

  it("is no heavier than last time after a second miss", () => {
    const state = withE1rm(
      history("bench", missed(60, main), missed(60, main)),
      100,
    );
    expect(prescribe(state).load?.value).toBe(60);
    expect(prescribe(state).reasons.map((r) => r.code)).toContain("stall");
  });

  it("progresses reps when the rack can't go heavier", () => {
    const state = withE1rm(history("bench", met(120, main)), 200);
    // 120 lb: 30 × (200 / 120 − 1) − 2 = 18 reps, capped at 12 − 2.
    expect(prescribe(state)).toMatchObject({
      load: { value: 120 },
      repMin: 10,
      repMax: 10,
    });
    expect(prescribe(state).reasons.map((r) => r.code)).toContain("max_load");
  });

  it("flags calibration", () => {
    const state = withE1rm(history("bench", met(60, main)), 80);
    const item = progressExercise(
      { ...state, firstLoggedDate: "2026-11-25" },
      bench,
      main,
      ctx(),
    );
    expect(item.reasons.map((r) => r.code)).toContain("calibrating");
  });
});

describe("plateau handler", () => {
  const onPlateau = (action: "rep_scheme" | "back_off" | "variation") => ({
    ...history("curl", met(25)),
    plateau: { action, startedOn: "2026-11-20" },
  });
  const flies: ProgressionExercise = {
    ...curl,
    id: "hammer",
    name: "Hammer curl",
  };

  it("shifts the rep range for a block", () => {
    const item = progressExercise(
      onPlateau("rep_scheme"),
      curl,
      accessory,
      ctx(),
    );
    expect([item.repMin, item.repMax]).toEqual([5, 9]);
    expect(item.reasons[0]?.code).toBe("plateau_rep_scheme");
    expect(
      progressExercise(onPlateau("rep_scheme"), curl, main, ctx()),
    ).toMatchObject({ repMin: 9, repMax: 11 });
  });

  it("adds a lighter back-off set", () => {
    const item = progressExercise(
      onPlateau("back_off"),
      curl,
      accessory,
      ctx(),
    );
    expect(item.backOff).toEqual({
      load: { value: 25, unit: "lb" },
      band: null,
      reps: 12,
    });
  });

  it("swaps in a same-group variation, or backs off when there is none", () => {
    expect(
      progressExercise(onPlateau("variation"), curl, accessory, ctx(), [
        curl,
        flies,
        bench,
      ]).swapTo,
    ).toBe("hammer");
    const alone = progressExercise(
      onPlateau("variation"),
      curl,
      accessory,
      ctx(),
      [curl],
    );
    expect(alone.swapTo).toBeNull();
    expect(alone.backOff).not.toBeNull();
  });

  it("ends after a block", () => {
    const item = progressExercise(
      onPlateau("back_off"),
      curl,
      accessory,
      ctx(DEFAULT_EQUIPMENT, "2026-12-18"),
    );
    expect(item.backOff).toBeNull();
  });
});

describe("properties", () => {
  const scenario = fc.record({
    load: fc.integer({ min: 1, max: 24 }).map((n) => n * 5),
    reps: fc.array(fc.integer({ min: 1, max: 16 }), {
      minLength: 1,
      maxLength: 4,
    }),
    rir: fc.option(fc.integer({ min: 0, max: 5 }), { nil: null }),
    exercise: fc.constantFrom(curl, bench),
    e1rm: fc.double({ min: 10, max: 300, noNaN: true }),
    priorMiss: fc.boolean(),
  });

  const stateFor = (s: {
    load: number;
    reps: number[];
    rir: number | null;
    exercise: ProgressionExercise;
    e1rm: number;
    priorMiss: boolean;
  }) => {
    const t = target(s.load, s.exercise === bench ? main : accessory);
    const logged: Session = {
      target: t,
      sets: s.reps.map((r) => [s.load, r, s.rir]),
    };
    const state = history(
      s.exercise.id,
      ...(s.priorMiss ? [missed(s.load)] : []),
      logged,
    );
    return {
      t,
      state: { ...state, e1rm: { value: s.e1rm, unit: "lb" as const } },
    };
  };

  it("prescribes only loads the equipment can make", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { state } = stateFor(s);
        const slot = s.exercise === bench ? main : accessory;
        const item = progressExercise(state, s.exercise, slot, ctx());
        return (
          item.load === null ||
          isLoadable(DEFAULT_EQUIPMENT, "dumbbell", item.load.value)
        );
      }),
    );
  });

  it("never raises a missed exercise's load at its next exposure", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { state, t } = stateFor(s);
        fc.pre(
          state.lastOutcome === "missed" || state.lastOutcome === "stalled",
        );
        const slot = s.exercise === bench ? main : accessory;
        const item = progressExercise(state, s.exercise, slot, ctx());
        return item.load !== null && item.load.value <= t.load!.value;
      }),
    );
  });

  it("always gives a reason", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { state } = stateFor(s);
        const slot = s.exercise === bench ? main : accessory;
        return (
          progressExercise(state, s.exercise, slot, ctx()).reasons.length > 0
        );
      }),
    );
  });
});
