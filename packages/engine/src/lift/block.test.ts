import { DEFAULT_EQUIPMENT } from "@workout-app/shared";
import { describe, expect, it } from "vitest";
import { ENGINE_CONFIG } from "../config.js";
import type { LiftSessionLog, LiftTarget } from "../stubs/lift.js";
import type { EngineContext } from "../types.js";
import {
  blockRir,
  capRampSets,
  layoffReentry,
  rampReason,
  scaleLoad,
  stalledMainLifts,
  weekOneLoad,
  weekScheme,
  type BlockPosition,
} from "./block.js";
import { updateLiftEngineState, type LiftEngineState } from "./state.js";

const config = ENGINE_CONFIG.lift;
const START = "2026-11-02";

const ctx: EngineContext = {
  date: START,
  weekType: "loading",
  readiness: "green",
  weightUnit: "lb",
  distanceUnit: "mi",
  equipment: DEFAULT_EQUIPMENT,
  config: ENGINE_CONFIG,
};

const at = (index: number, weekCount = 4): BlockPosition => ({
  startDate: START,
  index,
  weekCount,
  type: index === weekCount - 1 ? "deload" : "loading",
  earlyDeload: false,
});

const slot = { sets: 3, repMin: 8, repMax: 12, targetRir: 2, ramp: true };
const main = { progressionModel: "e1rm_rir" as const };
const accessory = { progressionModel: "double_progression" as const };

const target = (fields: Partial<LiftTarget> = {}): LiftTarget => ({
  load: { value: 50, unit: "lb" },
  band: null,
  sets: 3,
  repMin: 8,
  repMax: 12,
  targetRir: 2,
  ...fields,
});

const log = (
  date: string,
  reps: number,
  fields: Partial<LiftTarget> = {},
  id = "bench",
): LiftSessionLog => {
  const t = target(fields);
  return {
    session: { localDate: date },
    sets: Array.from({ length: t.sets }, (_, index) => ({
      exerciseId: id,
      index,
      loadValue: t.load?.value ?? null,
      loadUnit: t.load?.unit ?? null,
      band: null,
      reps,
      rir: 2,
      isWarmup: false,
    })),
    targets: { [id]: t },
  };
};

const fold = (...logs: LiftSessionLog[]): LiftEngineState =>
  logs.reduce((s, l) => updateLiftEngineState(s, l, config), {
    exercises: {},
  });

describe("blockRir", () => {
  const steps = (loading: number) =>
    Array.from({ length: loading }, (_, i) =>
      blockRir(i, loading, config.block),
    );

  it("steps 3 → 2 → 1, spreading the range over longer blocks", () => {
    expect(steps(2)).toEqual([3, 1]);
    expect(steps(3)).toEqual([3, 2, 1]);
    expect(steps(4)).toEqual([3, 2, 2, 1]);
    expect(steps(5)).toEqual([3, 2, 2, 1, 1]);
  });
});

describe("weekScheme", () => {
  it("steps main lifts' RIR down the loading weeks and leaves accessories", () => {
    const rir = (exercise: typeof main | typeof accessory, weekCount: number) =>
      Array.from(
        { length: weekCount - 1 },
        (_, i) =>
          weekScheme(slot, exercise, undefined, at(i, weekCount), ctx)
            .targetRir,
      );
    expect(rir(main, 4)).toEqual([3, 2, 1]);
    expect(rir(main, 6)).toEqual([3, 2, 2, 1, 1]);
    expect(rir(accessory, 4)).toEqual([2, 2, 2]);
    expect(
      weekScheme({ ...slot, targetRir: null }, main, undefined, at(1), ctx)
        .targetRir,
    ).toBeNull();
  });

  it("halves the sets, rounded up, at 3+ RIR on the deload", () => {
    const deload = weekScheme(
      { ...slot, sets: 5 },
      main,
      undefined,
      at(3),
      ctx,
    );
    expect(deload).toMatchObject({ sets: 3, targetRir: 3, rampSets: 0 });
    expect(deload.reasons[0]?.code).toBe("deload");
    expect(
      weekScheme({ ...slot, targetRir: 4 }, main, undefined, at(3), ctx)
        .targetRir,
    ).toBe(4);
    expect(
      weekScheme(slot, main, undefined, { ...at(2, 3), earlyDeload: true }, ctx)
        .reasons[0]?.code,
    ).toBe("early_deload");
  });

  it("gives ramp slots a set in weeks 2 and 3 after met targets", () => {
    const met = fold(log(START, 12));
    const missed = fold(log(START, 5));
    const scheme = (
      state: LiftEngineState,
      index: number,
      s: typeof slot = slot,
    ) => weekScheme(s, accessory, state.exercises.bench, at(index, 6), ctx);
    expect(scheme(met, 1)).toMatchObject({ rampSets: 1, rampGained: true });
    expect(scheme(missed, 1)).toMatchObject({ rampSets: 0 });
    expect(scheme(met, 1, { ...slot, ramp: false }).rampSets).toBe(0);
    expect(scheme(met, 0).rampSets).toBe(0);

    const week2met = fold(log("2026-11-09", 12, { sets: 4 }));
    const week2missed = fold(log("2026-11-09", 5, { sets: 4 }));
    expect(scheme(week2met, 2)).toMatchObject({
      rampSets: 2,
      rampGained: true,
    });
    expect(scheme(week2missed, 2)).toMatchObject({
      rampSets: 1,
      rampGained: false,
    });

    const week3 = fold(log("2026-11-16", 12, { sets: 5 }));
    expect(scheme(week3, 3)).toMatchObject({ rampSets: 2, rampGained: false });

    const lastBlock = fold(log("2026-10-26", 12, { sets: 5 }));
    expect(scheme(lastBlock, 1).rampSets).toBe(0);
  });
});

describe("capRampSets", () => {
  it("holds ramp sets to the weekly hard-set cap per muscle", () => {
    const granted = capRampSets(
      [
        { muscles: ["chest"], sets: 9, rampSets: 2 },
        { muscles: ["chest", "triceps"], sets: 8, rampSets: 2 },
        { muscles: ["triceps"], sets: 3, rampSets: 1 },
        { muscles: [], sets: 3, rampSets: 1 },
      ],
      20,
    );
    expect(granted).toEqual([
      { rampSets: 2, cappedBy: null },
      { rampSets: 1, cappedBy: "chest" },
      { rampSets: 1, cappedBy: null },
      { rampSets: 1, cappedBy: null },
    ]);
    expect(
      capRampSets([{ muscles: ["quads"], sets: 21, rampSets: 1 }], 20),
    ).toEqual([{ rampSets: 0, cappedBy: "quads" }]);
  });

  it("explains the set count", () => {
    const scheme = { sets: 3, rampSets: 1, rampGained: true };
    expect(rampReason(scheme, { rampSets: 1, cappedBy: null }, 20)?.code).toBe(
      "ramp_set",
    );
    expect(
      rampReason(
        { ...scheme, rampGained: false },
        { rampSets: 1, cappedBy: null },
        20,
      )?.code,
    ).toBe("ramp_hold");
    expect(
      rampReason(scheme, { rampSets: 0, cappedBy: "chest" }, 20)?.text,
    ).toBe("3 sets: chest is at its cap of 20 hard sets this week.");
    expect(rampReason(scheme, { rampSets: 0, cappedBy: null }, 20)).toBeNull();
  });
});

describe("stalledMainLifts", () => {
  it("counts main lifts that stalled in the window", () => {
    const misses = (id: string, dates: string[]) =>
      dates.map((d) => log(d, 5, {}, id));
    const state = fold(
      ...misses("bench", ["2026-11-02", "2026-11-05"]),
      ...misses("squat", ["2026-11-03", "2026-11-10"]),
      ...misses("curl", ["2026-11-03", "2026-11-06"]),
      ...misses("row", ["2026-11-04"]),
    );
    expect(state.exercises.bench?.lastStallDate).toBe("2026-11-05");
    const exercises = [
      { id: "bench", ...main },
      { id: "squat", ...main },
      { id: "curl", ...accessory },
      { id: "row", ...main },
    ];
    expect(stalledMainLifts(state, exercises, START, "2026-11-09")).toBe(1);
    expect(stalledMainLifts(state, exercises, START, "2026-11-16")).toBe(2);
    expect(stalledMainLifts(state, exercises, "2026-11-09", "2026-11-16")).toBe(
      1,
    );
  });
});

describe("deload loads", () => {
  it("uses the week-1 load", () => {
    const state = fold(
      log(START, 10, { load: { value: 60, unit: "lb" } }),
      log("2026-11-09", 10, { load: { value: 65, unit: "lb" } }),
    );
    expect(weekOneLoad(state.exercises.bench, START)).toEqual({
      value: 60,
      unit: "lb",
    });
    expect(weekOneLoad(state.exercises.bench, "2026-10-26")).toBeNull();
    expect(weekOneLoad(undefined, START)).toBeNull();
  });

  it("scales to a loadable weight, always lighter when possible", () => {
    const db = {
      id: "db",
      name: "DB",
      equipment: ["dumbbell"],
      substitutionGroup: null,
    };
    const scale = (value: number, factor: number) =>
      scaleLoad({ value, unit: "lb" }, factor, db, ctx).value;
    expect(scale(60, 0.9)).toBe(55);
    expect(scale(100, 0.9)).toBe(90);
    expect(scale(25, 0.925)).toBe(20);
    expect(scale(5, 0.9)).toBe(5);
    expect(scaleLoad({ value: 100, unit: "lb" }, 0.9, null, ctx)).toEqual({
      value: 90,
      unit: "lb",
    });
  });
});

describe("layoffReentry", () => {
  const back = (gap: number) => {
    const date = "2026-11-30";
    const last = new Date(Date.parse(date) - gap * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return layoffReentry([last], date, config.layoff);
  };

  it("cuts by the length of the layoff", () => {
    expect(back(6)).toBeNull();
    expect(back(7)).toMatchObject({
      cut: 0.075,
      reason: { code: "layoff_short" },
    });
    expect(back(13)).toMatchObject({
      cut: 0.075,
      reason: { code: "layoff_short" },
    });
    expect(back(14)).toMatchObject({
      cut: 0.175,
      reason: { code: "layoff_long" },
    });
    expect(back(20)?.reason.text).toBe(
      "20 days since your last lift: 17.5% lighter for your first week back.",
    );
    expect(layoffReentry([], "2026-11-30", config.layoff)).toBeNull();
  });

  it("cuts only the first session back after a short layoff", () => {
    const dates = ["2026-11-01", "2026-11-09"];
    expect(layoffReentry(dates, "2026-11-10", config.layoff)).toBeNull();
  });

  it("cuts a week after a long layoff", () => {
    const dates = ["2026-11-01", "2026-11-15", "2026-11-17"];
    expect(layoffReentry(dates, "2026-11-21", config.layoff)?.cut).toBe(0.175);
    expect(
      layoffReentry([...dates, "2026-11-21"], "2026-11-22", config.layoff),
    ).toBeNull();
  });
});
