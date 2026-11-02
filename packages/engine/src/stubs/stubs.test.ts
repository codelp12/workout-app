import {
  DEFAULT_EQUIPMENT,
  MAIN_LIFTS,
  type Onboarding,
  type TemplateSlot,
} from "@workout-app/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CLIMB_WORKOUT_TYPES,
  ENGINE_CONFIG,
  RUN_WORKOUT_TYPES,
} from "../config.js";
import { isLoadable } from "../loads.js";
import type { EngineContext } from "../types.js";
import { climbStub } from "./climb.js";
import { liftStub, type LiftExercise, type LiftIntent } from "./lift.js";
import { runStub } from "./run.js";

const ctx: EngineContext = {
  date: "2026-11-09",
  weekType: "loading",
  readiness: "green",
  weightUnit: "lb",
  distanceUnit: "mi",
  equipment: DEFAULT_EQUIPMENT,
  config: ENGINE_CONFIG,
};

const [squat, bench, rdl, press, row] = MAIN_LIFTS.map((l) => l.exerciseId);
const dumbbell = (id: string, name: string, group: string | null = null) =>
  ({
    id,
    name,
    equipment: ["dumbbell"],
    substitutionGroup: group,
  }) satisfies LiftExercise;
const exercises: LiftExercise[] = [
  dumbbell(squat!, "Dumbbell squat", "squat_quads"),
  dumbbell(bench!, "Dumbbell bench press", "horizontal_push_chest"),
  dumbbell(rdl!, "Dumbbell RDL"),
  dumbbell(press!, "Dumbbell overhead press"),
  dumbbell(row!, "One-arm dumbbell row"),
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Barbell squat",
    equipment: ["barbell"],
    substitutionGroup: "squat_quads",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Pushups",
    equipment: ["bodyweight"],
    substitutionGroup: "horizontal_push_chest",
  },
];

const slot = (over: Partial<TemplateSlot>): TemplateSlot => ({
  exerciseId: null,
  substitutionGroup: null,
  sets: 3,
  repMin: 6,
  repMax: 10,
  targetRir: 2,
  restSec: 120,
  ramp: false,
  ...over,
});

const onboarding: Onboarding = {
  completedAt: 0,
  lifts: [
    { exerciseId: bench!, load: { value: 60, unit: "lb" }, reps: 8, rir: 2 },
    { exerciseId: squat!, load: { value: 25, unit: "kg" }, reps: 10, rir: 3 },
  ],
  run: {
    distanceValue: 5,
    distanceUnit: "km",
    durationSec: 1500,
    rpe: 8,
    weeklyDistance: 10,
  },
  climb: { discipline: "boulder", limitGrade: "V4", volumeGrade: "V2" },
};

const pushA: LiftIntent = {
  name: "Push A",
  slots: [slot({ exerciseId: bench! }), slot({ exerciseId: press! })],
  exercises,
};

const codes = (reasons: { code: string }[]) => reasons.map((r) => r.code);

describe("lift stub", () => {
  it("prefills from onboarding, then from the last session", () => {
    let state = liftStub.initState(onboarding);
    const [first, pressItem] = liftStub.prescribe(state, pushA, ctx).items;
    let benchItem = first;
    expect(benchItem).toMatchObject({
      exerciseId: bench,
      sets: 3,
      load: { value: 60, unit: "lb" },
      repMin: 6,
      repMax: 10,
      targetRir: 2,
    });
    expect(benchItem?.reasons[0]).toEqual({
      code: "from_setup",
      text: "From your setup answers: 60 lb × 8 at 2 RIR.",
    });
    expect(pressItem?.load).toBeNull();
    expect(codes(pressItem?.reasons ?? [])).toEqual(["no_history"]);

    const set = {
      exerciseId: bench!,
      loadUnit: "lb" as const,
      band: null,
      reps: 8,
      rir: 2,
    };
    state = liftStub.update(state, {
      session: { localDate: "2026-11-04" },
      sets: [
        { ...set, index: 0, loadValue: 30, isWarmup: true },
        { ...set, index: 1, loadValue: 65, isWarmup: false },
        { ...set, index: 2, loadValue: 65, isWarmup: false, reps: 7 },
      ],
    });
    [benchItem] = liftStub.prescribe(state, pushA, ctx).items;
    expect(benchItem?.load).toEqual({ value: 65, unit: "lb" });
    expect(benchItem?.reasons[0]).toEqual({
      code: "repeat_last",
      text: "Same as last time (2026-11-04): 65 lb × 8 at 2 RIR.",
    });

    // An older session logged late doesn't replace the newer one.
    state = liftStub.update(state, {
      session: { localDate: "2026-11-01" },
      sets: [{ ...set, index: 0, loadValue: 50, isWarmup: false }],
    });
    expect(liftStub.prescribe(state, pushA, ctx).items[0]?.load?.value).toBe(
      65,
    );
  });

  it("converts units and rounds to the rack", () => {
    const state = liftStub.initState(onboarding);
    const intent: LiftIntent = {
      ...pushA,
      slots: [slot({ exerciseId: squat! })],
    };
    const [item] = liftStub.prescribe(state, intent, ctx).items;
    // 25 kg is 55.1 lb; the nearest dumbbell is 55 lb.
    expect(item?.load).toEqual({ value: 55, unit: "lb" });
    expect(codes(item?.reasons ?? [])).toEqual(["from_setup", "rounded"]);
  });

  it("says so when the equipment can't make the load", () => {
    const state = liftStub.initState(onboarding);
    const [item] = liftStub.prescribe(state, pushA, {
      ...ctx,
      equipment: { ...DEFAULT_EQUIPMENT, dumbbells: null },
    }).items;
    expect(item?.load).toBeNull();
    expect(codes(item?.reasons ?? [])).toEqual(["from_setup", "not_loadable"]);
  });

  it("fills group slots with the dumbbell, band or bodyweight option first", () => {
    const state = liftStub.initState(null);
    const intent: LiftIntent = {
      ...pushA,
      slots: [
        slot({ substitutionGroup: "squat_quads" }),
        slot({ substitutionGroup: "nothing_here" }),
      ],
    };
    const [squatItem, missing] = liftStub.prescribe(state, intent, ctx).items;
    expect(squatItem?.exerciseId).toBe(squat);
    expect(codes(squatItem?.reasons ?? [])).toEqual([
      "substituted",
      "no_history",
    ]);
    expect(missing?.exerciseId).toBeNull();
    expect(codes(missing?.reasons ?? [])).toEqual(["no_exercise"]);
  });
});

describe("run stub", () => {
  it("splits the setup week, then repeats the last run of the type", () => {
    let state = runStub.initState(onboarding);
    const long = runStub.prescribe(state, { workoutType: "long" }, ctx);
    // 10 km is 6.2 mi; 40% is 2.5 mi.
    expect(long.distance).toEqual({ value: 2.5, unit: "mi" });
    expect(long.targetRpe).toEqual({ min: 4, max: 5 });
    expect(long.reasons[0]?.text).toBe(
      "40% of the 6.2 mi week from your setup answers.",
    );

    state = runStub.update(state, {
      session: { localDate: "2026-11-08" },
      run: {
        workoutType: "long",
        distanceValue: 6,
        distanceUnit: "mi",
        durationSec: 3600,
      },
    });
    const next = runStub.prescribe(state, { workoutType: "long" }, ctx);
    expect(next.distance).toEqual({ value: 6, unit: "mi" });
    expect(codes(next.reasons)).toEqual(["repeat_last", "target_rpe"]);
    expect(
      runStub.prescribe(
        state,
        { workoutType: "easy" },
        { ...ctx, distanceUnit: "km" },
      ).distance,
    ).toEqual({ value: 3, unit: "km" });
  });

  it("runs by feel with no history", () => {
    const easy = runStub.prescribe(
      runStub.initState(null),
      { workoutType: "easy" },
      ctx,
    );
    expect(easy.distance).toBeNull();
    expect(codes(easy.reasons)).toEqual(["no_history", "target_rpe"]);
  });
});

describe("climb stub", () => {
  it("brackets the setup grades", () => {
    const state = climbStub.initState(onboarding);
    const limit = climbStub.prescribe(state, { workoutType: "limit" }, ctx);
    expect(limit).toMatchObject({
      discipline: "boulder",
      grades: { min: "V3", max: "V5" },
      problems: { min: 3, max: 5 },
      maxHardAttempts: 12,
    });
    const volume = climbStub.prescribe(state, { workoutType: "volume" }, ctx);
    expect(volume).toMatchObject({
      grades: { min: "V0", max: "V1" },
      maxHardAttempts: null,
    });
  });

  it("clamps to the scale and handles routes", () => {
    const state = climbStub.initState({
      ...onboarding,
      climb: { discipline: "route", limitGrade: "5.13d", volumeGrade: "5.7" },
    });
    expect(
      climbStub.prescribe(state, { workoutType: "limit" }, ctx).grades,
    ).toEqual({
      min: "5.13c",
      max: "5.13d",
    });
    expect(
      climbStub.prescribe(state, { workoutType: "volume" }, ctx).grades,
    ).toEqual({
      min: "5.6",
      max: "5.6",
    });
  });

  it("notes the last hardest send, ignoring attempts", () => {
    const state = climbStub.update(climbStub.initState(onboarding), {
      session: { localDate: "2026-11-05" },
      ascents: [
        { grade: "V5", style: "send" },
        { grade: "V7", style: "attempt" },
        { grade: "V3", style: "flash" },
      ],
    });
    const limit = climbStub.prescribe(state, { workoutType: "limit" }, ctx);
    expect(limit.reasons.at(-1)?.text).toBe(
      "Last hardest send: V5 (2026-11-05).",
    );
  });

  it("climbs by feel with no grades", () => {
    const limit = climbStub.prescribe(
      climbStub.initState(null),
      { workoutType: "limit" },
      ctx,
    );
    expect(limit.grades).toBeNull();
    expect(codes(limit.reasons)).toEqual(["no_history", "attempt_cap"]);
  });
});

// --- Properties (SPEC §5.6) -------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const weightArb = fc.record({
  value: fc.double({ min: 0, max: 300, noNaN: true }),
  unit: fc.constantFrom("lb" as const, "kg" as const),
});
const onboardingArb: fc.Arbitrary<Onboarding | null> = fc.option(
  fc.record({
    completedAt: fc.nat(),
    lifts: fc.uniqueArray(
      fc.record({
        exerciseId: fc.constantFrom(...MAIN_LIFTS.map((l) => l.exerciseId)),
        load: weightArb,
        reps: fc.integer({ min: 1, max: 20 }),
        rir: fc.integer({ min: 0, max: 4 }),
      }),
      { selector: (l) => l.exerciseId },
    ),
    run: fc.option(
      fc.record({
        distanceValue: fc.double({ min: 0.1, max: 50, noNaN: true }),
        distanceUnit: fc.constantFrom("mi" as const, "km" as const),
        durationSec: fc.integer({ min: 1, max: 20_000 }),
        rpe: fc.integer({ min: 1, max: 10 }),
        weeklyDistance: fc.double({ min: 0, max: 100, noNaN: true }),
      }),
    ),
    climb: fc.option(
      fc.oneof(
        fc.record({
          discipline: fc.constant("boulder" as const),
          limitGrade: fc.constantFrom("V0", "V4", "V12", "V20"),
          volumeGrade: fc.constantFrom("V0", "V2", "V12"),
        }),
        fc.record({
          discipline: fc.constant("route" as const),
          limitGrade: fc.constantFrom("5.6", "5.11a", "5.13d"),
          volumeGrade: fc.constantFrom("5.6", "5.10a"),
        }),
      ),
    ),
  }),
);
const slotArb = fc.record({
  exerciseId: fc.option(fc.constantFrom(...exercises.map((e) => e.id))),
  substitutionGroup: fc.constantFrom(
    "squat_quads",
    "horizontal_push_chest",
    "none",
  ),
  sets: fc.integer({ min: 1, max: 6 }),
  repMin: fc.integer({ min: 1, max: 10 }),
  repMax: fc.integer({ min: 10, max: 20 }),
  targetRir: fc.option(fc.integer({ min: 0, max: 4 })),
  restSec: fc.nat({ max: 300 }),
  ramp: fc.boolean(),
});
const ctxArb = fc.record({
  weightUnit: fc.constantFrom("lb" as const, "kg" as const),
  distanceUnit: fc.constantFrom("mi" as const, "km" as const),
});

describe("every stub", () => {
  it("is deterministic, leaves its inputs alone and always gives a reason", () => {
    fc.assert(
      fc.property(
        onboardingArb,
        fc.array(slotArb, { maxLength: 8 }),
        ctxArb,
        (ob, slots, units) => {
          const context = deepFreeze({ ...ctx, ...units });
          const intent = deepFreeze({ name: "T", slots, exercises });
          const frozen = deepFreeze(ob);
          const lift = deepFreeze(liftStub.initState(frozen));
          const lifted = liftStub.prescribe(lift, intent, context);
          expect(liftStub.prescribe(lift, intent, context)).toEqual(lifted);
          expect(lifted.reasons.length).toBeGreaterThan(0);
          for (const item of lifted.items) {
            expect(item.reasons.length).toBeGreaterThan(0);
            if (item.load) {
              expect(item.load.unit).toBe(units.weightUnit);
              expect(
                isLoadable(context.equipment, "dumbbell", item.load.value),
              ).toBe(true);
            }
          }

          const run = deepFreeze(runStub.initState(frozen));
          for (const workoutType of RUN_WORKOUT_TYPES) {
            const p = runStub.prescribe(run, { workoutType }, context);
            expect(runStub.prescribe(run, { workoutType }, context)).toEqual(p);
            expect(p.reasons.length).toBeGreaterThan(0);
          }
          const climb = deepFreeze(climbStub.initState(frozen));
          for (const workoutType of CLIMB_WORKOUT_TYPES) {
            const p = climbStub.prescribe(climb, { workoutType }, context);
            expect(
              climbStub.prescribe(climb, { workoutType }, context),
            ).toEqual(p);
            expect(p.reasons.length).toBeGreaterThan(0);
          }
        },
      ),
    );
  });

  it("prescribes a session in under 50 ms", () => {
    let state = liftStub.initState(onboarding);
    for (let day = 1; day <= 28; day++) {
      state = liftStub.update(state, {
        session: { localDate: `2026-10-${String(day).padStart(2, "0")}` },
        sets: exercises.flatMap((e) =>
          [0, 1, 2].map((index) => ({
            exerciseId: e.id,
            index,
            loadValue: 40 + day,
            loadUnit: "lb" as const,
            band: null,
            reps: 8,
            rir: 2,
            isWarmup: false,
          })),
        ),
      });
    }
    const intent: LiftIntent = {
      ...pushA,
      slots: exercises.map((e) => slot({ exerciseId: e.id })),
    };
    const start = Date.now();
    liftStub.prescribe(state, intent, ctx);
    runStub.prescribe(
      runStub.initState(onboarding),
      { workoutType: "long" },
      ctx,
    );
    climbStub.prescribe(
      climbStub.initState(onboarding),
      { workoutType: "limit" },
      ctx,
    );
    expect(Date.now() - start).toBeLessThan(50);
  });
});
