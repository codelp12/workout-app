import {
  DEFAULT_EQUIPMENT,
  MAIN_LIFTS,
  type Onboarding,
} from "@workout-app/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ENGINE_CONFIG } from "../config.js";
import { isLoadable } from "../loads.js";
import type { LiftSessionLog, LiftSet } from "../stubs/lift.js";
import {
  e1rmOf,
  e1rmSeries,
  initLiftEngineState,
  isCalibrating,
  loadFor,
  prescribedLoad,
  sessionEstimate,
  smoothE1rm,
  updateLiftEngineState,
} from "./state.js";

const config = ENGINE_CONFIG.lift;
const [squat = "", bench = ""] = MAIN_LIFTS.map((l) => l.exerciseId);

const set = (
  value: number | null,
  reps: number,
  rir: number | null,
): LiftSet => ({
  load: value === null ? null : { value, unit: "lb" },
  band: null,
  reps,
  rir,
});

const onboarding: Onboarding = {
  completedAt: 0,
  lifts: [
    { exerciseId: squat, load: { value: 50, unit: "lb" }, reps: 8, rir: 2 },
  ],
  run: null,
  climb: null,
};

let index = 0;
const session = (
  localDate: string,
  exerciseId: string,
  sets: {
    load: number | null;
    reps: number;
    rir: number | null;
    warmup?: boolean;
  }[],
): LiftSessionLog => ({
  session: { localDate },
  sets: sets.map((s) => ({
    exerciseId,
    index: index++,
    loadValue: s.load,
    loadUnit: s.load === null ? null : "lb",
    band: null,
    reps: s.reps,
    rir: s.rir,
    isWarmup: s.warmup ?? false,
  })),
});

describe("e1RM formulas", () => {
  it.each([
    [100, 10, 0, 133.333],
    [50, 8, 2, 66.667],
    [60, 5, 3, 76],
    [100, 1, 0, 103.333],
  ])("%d lb × %d at %d RIR is an e1RM of %d", (load, reps, rir, e1rm) => {
    expect(e1rmOf(load, reps, rir)).toBeCloseTo(e1rm, 3);
    expect(loadFor(e1rm, reps, rir)).toBeCloseTo(load, 2);
  });

  it("rounds the prescribed load to the rack, ties going lighter", () => {
    // 80 ÷ (1 + 10/30) = 60 exactly.
    expect(
      prescribedLoad(
        { value: 80, unit: "lb" },
        8,
        2,
        "lb",
        DEFAULT_EQUIPMENT,
        "dumbbell",
      ),
    ).toEqual({ value: 60, unit: "lb" });
    // 75 ÷ 1.3333 = 56.25 → 55.
    expect(
      prescribedLoad(
        { value: 75, unit: "lb" },
        8,
        2,
        "lb",
        DEFAULT_EQUIPMENT,
        "dumbbell",
      ),
    ).toEqual({ value: 55, unit: "lb" });
  });

  it("converts an e1RM to the prescription's unit", () => {
    const load = prescribedLoad(
      { value: 40, unit: "kg" },
      8,
      2,
      "lb",
      DEFAULT_EQUIPMENT,
      "dumbbell",
    );
    // 40 kg = 88.2 lb, ÷ 1.3333 = 66.1 → 65.
    expect(load).toEqual({ value: 65, unit: "lb" });
  });

  it("returns null when the equipment can't make a load", () => {
    expect(
      prescribedLoad(
        { value: 80, unit: "lb" },
        8,
        2,
        "lb",
        { ...DEFAULT_EQUIPMENT, dumbbells: null },
        "dumbbell",
      ),
    ).toBeNull();
  });

  it("always prescribes a loadable dumbbell", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 7, max: 150, noNaN: true }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 4 }),
        (e1rm, reps, rir) => {
          const load = prescribedLoad(
            { value: e1rm, unit: "lb" },
            reps,
            rir,
            "lb",
            DEFAULT_EQUIPMENT,
            "dumbbell",
          );
          return (
            load === null ||
            isLoadable(DEFAULT_EQUIPMENT, "dumbbell", load.value)
          );
        },
      ),
    );
  });
});

describe("sessionEstimate", () => {
  it("takes the best hard set", () => {
    expect(
      sessionEstimate(
        [set(50, 10, 2), set(55, 8, 1), set(55, 6, 0)],
        "lb",
        config,
      ),
    ).toBeCloseTo(e1rmOf(55, 8, 1));
  });

  it.each([
    ["reps + RIR over 12", [set(30, 12, 1)]],
    ["no load", [set(null, 10, 2)]],
    ["no sets", []],
  ])("ignores sets with %s", (_name, sets) => {
    expect(sessionEstimate(sets, "lb", config)).toBeNull();
  });

  it("counts reps + RIR of exactly 12", () => {
    expect(sessionEstimate([set(30, 10, 2)], "lb", config)).toBeCloseTo(42);
  });

  it("counts a set with no RIR as RIR 0", () => {
    expect(sessionEstimate([set(60, 6, null)], "lb", config)).toBeCloseTo(72);
  });

  it("converts each set to the given unit", () => {
    expect(
      sessionEstimate(
        [{ ...set(null, 6, 0), load: { value: 30, unit: "kg" } }],
        "lb",
        config,
      ),
    ).toBeCloseTo(30 * 2.20462262 * 1.2, 3);
  });
});

describe("smoothE1rm", () => {
  it.each([
    // previous, estimate, calibrating, expected
    [100, 102, false, 100.6], // up: 100 + 0.3 × 2
    [100, 120, false, 103], // up 6, capped at +3%
    [100, 120, true, 101.5], // calibration caps at +1.5%
    [100, 90, false, 95], // down: 100 − 0.5 × 10, no cap
    [100, 90, true, 95],
    [100, 100, false, 100],
  ])(
    "%d toward %d (calibrating %s) is %d",
    (previous, estimate, calibrating, expected) => {
      expect(smoothE1rm(previous, estimate, calibrating, config)).toBeCloseTo(
        expected,
      );
    },
  );

  it("never rises more than the cap and never overshoots the estimate", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 500, noNaN: true }),
        fc.double({ min: 1, max: 500, noNaN: true }),
        fc.boolean(),
        (previous, estimate, calibrating) => {
          const next = smoothE1rm(previous, estimate, calibrating, config);
          const cap = calibrating ? config.calibration.maxRise : config.maxRise;
          const low = Math.min(previous, estimate);
          const high = Math.max(previous, estimate);
          return (
            next <= previous * (1 + cap) + 1e-9 &&
            next >= low - 1e-9 &&
            next <= high + 1e-9
          );
        },
      ),
    );
  });
});

describe("calibration", () => {
  it("lasts 14 days from the first logged session", () => {
    const first = { firstLoggedDate: "2026-11-02" };
    expect(isCalibrating({ firstLoggedDate: null }, "2026-11-02", config)).toBe(
      true,
    );
    expect(isCalibrating(first, "2026-11-02", config)).toBe(true);
    expect(isCalibrating(first, "2026-11-15", config)).toBe(true);
    expect(isCalibrating(first, "2026-11-16", config)).toBe(false);
  });
});

describe("lift engine state", () => {
  it("starts from the onboarding answers", () => {
    const state = initLiftEngineState(onboarding, config);
    expect(state.exercises[squat]).toEqual({
      e1rm: { value: expect.closeTo(66.667, 3) as number, unit: "lb" },
      confidence: 0.3,
      exposures: [{ date: "", source: "onboarding", sets: [set(50, 8, 2)] }],
      firstLoggedDate: null,
      stallCount: 0,
      lastIncreaseDate: null,
    });
    expect(initLiftEngineState(null, config)).toEqual({ exercises: {} });
  });

  it("starts from logged history when there are no answers", () => {
    const state = updateLiftEngineState(
      initLiftEngineState(null, config),
      session("2026-11-02", bench, [
        { load: 20, reps: 10, rir: null, warmup: true },
        { load: 45, reps: 8, rir: 2 },
      ]),
      config,
    );
    const bench1 = state.exercises[bench];
    expect(bench1?.e1rm?.value).toBeCloseTo(60);
    expect(bench1?.confidence).toBeCloseTo(0.3);
    expect(bench1?.firstLoggedDate).toBe("2026-11-02");
    expect(bench1?.exposures).toHaveLength(1);
    expect(bench1?.exposures[0]?.sets).toHaveLength(1);
    expect(bench1?.lastIncreaseDate).toBeNull();
  });

  it("smooths toward each session, capped tighter while calibrating", () => {
    let state = initLiftEngineState(onboarding, config);
    // e1RM 66.67; a strong first session estimates 80 but calibration caps +1.5%.
    state = updateLiftEngineState(
      state,
      session("2026-11-02", squat, [{ load: 60, reps: 8, rir: 2 }]),
      config,
    );
    const day1 = (200 / 3) * 1.015;
    expect(state.exercises[squat]?.e1rm?.value).toBeCloseTo(day1);
    expect(state.exercises[squat]?.lastIncreaseDate).toBe("2026-11-02");
    expect(state.exercises[squat]?.confidence).toBeCloseTo(0.51);
    // Past calibration the cap is +3%.
    state = updateLiftEngineState(
      state,
      session("2026-11-16", squat, [{ load: 60, reps: 8, rir: 2 }]),
      config,
    );
    expect(state.exercises[squat]?.e1rm?.value).toBeCloseTo(day1 * 1.03);
    // A bad day drops it by half the gap.
    const before = state.exercises[squat]?.e1rm?.value ?? 0;
    state = updateLiftEngineState(
      state,
      session("2026-11-23", squat, [{ load: 40, reps: 8, rir: 2 }]),
      config,
    );
    expect(state.exercises[squat]?.e1rm?.value).toBeCloseTo(
      before - 0.5 * (before - e1rmOf(40, 8, 2)),
    );
    expect(state.exercises[squat]?.lastIncreaseDate).toBe("2026-11-16");
  });

  it("keeps the e1RM when a session has no loaded hard set", () => {
    const start = initLiftEngineState(onboarding, config);
    const state = updateLiftEngineState(
      start,
      session("2026-11-02", squat, [{ load: 20, reps: 15, rir: 2 }]),
      config,
    );
    expect(state.exercises[squat]?.e1rm).toEqual(start.exercises[squat]?.e1rm);
    expect(state.exercises[squat]?.confidence).toBe(0.3);
    expect(state.exercises[squat]?.exposures).toHaveLength(2);
  });

  it("keeps the last few exposures", () => {
    let state = initLiftEngineState(onboarding, config);
    for (let day = 10; day < 20; day++) {
      state = updateLiftEngineState(
        state,
        session(`2026-11-${day}`, squat, [{ load: 50, reps: 8, rir: 2 }]),
        config,
      );
    }
    const exposures = state.exercises[squat]?.exposures ?? [];
    expect(exposures).toHaveLength(config.exposuresKept);
    expect(exposures.at(-1)?.date).toBe("2026-11-19");
  });

  it("ignores a session older than the latest exposure", () => {
    const later = updateLiftEngineState(
      initLiftEngineState(null, config),
      session("2026-11-09", bench, [{ load: 45, reps: 8, rir: 2 }]),
      config,
    );
    expect(
      updateLiftEngineState(
        later,
        session("2026-11-02", bench, [{ load: 60, reps: 8, rir: 2 }]),
        config,
      ),
    ).toEqual(later);
  });

  it("is deterministic and never mutates its input", () => {
    const start = initLiftEngineState(onboarding, config);
    const copy = JSON.parse(JSON.stringify(start)) as typeof start;
    const log = session("2026-11-02", squat, [{ load: 55, reps: 8, rir: 2 }]);
    expect(updateLiftEngineState(start, log, config)).toEqual(
      updateLiftEngineState(start, log, config),
    );
    expect(start).toEqual(copy);
  });
});

describe("e1rmSeries", () => {
  it("has a point per exercise per day trained, after that day's sessions", () => {
    const points = e1rmSeries(
      onboarding,
      "2026-11-01",
      [
        session("2026-11-04", squat, [{ load: 50, reps: 8, rir: 2 }]),
        session("2026-11-02", bench, [{ load: 45, reps: 8, rir: 2 }]),
        session("2026-11-02", bench, [{ load: 50, reps: 8, rir: 2 }]),
        session("2026-11-03", bench, [
          { load: 10, reps: 12, rir: null, warmup: true },
        ]),
      ],
      config,
    );
    expect(
      points.map((p) => [p.date, p.exerciseId === squat ? "squat" : "bench"]),
    ).toEqual([
      ["2026-11-01", "squat"],
      ["2026-11-02", "bench"],
      ["2026-11-04", "squat"],
    ]);
    // Bench: 60 from the first session, then +1.5% toward 66.7 in calibration.
    expect(points[1]?.e1rm.value).toBeCloseTo(60 * 1.015);
    expect(points[1]?.confidence).toBeCloseTo(0.51);
  });

  it("leaves out the onboarding point without a date", () => {
    expect(e1rmSeries(onboarding, null, [], config)).toEqual([]);
  });
});
