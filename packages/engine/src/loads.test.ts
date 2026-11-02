import { DEFAULT_EQUIPMENT, type Equipment } from "@workout-app/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  availableLoads,
  isLoadable,
  roundBandLevel,
  roundToLoadable,
  type ListedImplement,
  type Rounding,
  type WeightImplement,
} from "./loads.js";

const defaults = DEFAULT_EQUIPMENT;

describe("default inventory", () => {
  it("has dumbbells 5–120 lb in 5 lb steps", () => {
    const loads = availableLoads(defaults, "dumbbell");
    expect(loads).toHaveLength(24);
    expect(loads[0]).toBe(5);
    expect(loads.at(-1)).toBe(120);
    expect(loads.every((w) => w % 5 === 0)).toBe(true);
  });

  it("has fixed barbells 20–110 lb in 10 lb steps", () => {
    expect(availableLoads(defaults, "barbell")).toEqual([
      20, 30, 40, 50, 60, 70, 80, 90, 100, 110,
    ]);
  });

  it("has no loadable bar or stack", () => {
    expect(availableLoads(defaults, "bar")).toEqual([]);
    expect(roundToLoadable(defaults, "bar", 135)).toBeNull();
    expect(roundToLoadable(defaults, "stack", 50)).toBeNull();
  });

  it.each<[WeightImplement, number, Rounding, number | null]>([
    ["dumbbell", 50, "nearest", 50],
    ["dumbbell", 52, "nearest", 50],
    ["dumbbell", 53, "nearest", 55],
    ["dumbbell", 52.5, "nearest", 50],
    ["dumbbell", 52.5, "up", 55],
    ["dumbbell", 54.9, "down", 50],
    ["dumbbell", 50.1, "up", 55],
    ["dumbbell", 2, "nearest", 5],
    ["dumbbell", 2, "down", null],
    ["dumbbell", 2, "up", 5],
    ["dumbbell", 0, "nearest", 5],
    ["dumbbell", 130, "nearest", 120],
    ["dumbbell", 130, "down", 120],
    ["dumbbell", 130, "up", null],
    ["barbell", 64, "nearest", 60],
    ["barbell", 65, "nearest", 60],
    ["barbell", 66, "nearest", 70],
    ["barbell", 65, "up", 70],
    ["barbell", 15, "nearest", 20],
    ["barbell", 15, "down", null],
    ["barbell", 135, "nearest", 110],
    ["barbell", 135, "up", null],
  ])("rounds %s %d (%s) to %s", (implement, target, rounding, expected) => {
    expect(roundToLoadable(defaults, implement, target, rounding)).toBe(
      expected,
    );
  });

  it.each<[number, Rounding, string | null]>([
    [0, "nearest", "Light"],
    [1, "nearest", "Medium"],
    [1.5, "nearest", "Medium"],
    [1.6, "nearest", "Heavy"],
    [1.5, "up", "Heavy"],
    [-1, "nearest", "Light"],
    [-1, "down", null],
    [9, "nearest", "Extra heavy"],
    [9, "up", null],
  ])("rounds band level %d (%s) to %s", (level, rounding, expected) => {
    expect(roundBandLevel(defaults, level, rounding)?.name ?? null).toBe(
      expected,
    );
  });

  it("checks exact loads", () => {
    expect(isLoadable(defaults, "dumbbell", 45)).toBe(true);
    expect(isLoadable(defaults, "dumbbell", 47.5)).toBe(false);
    expect(isLoadable(defaults, "dumbbell", 125)).toBe(false);
    expect(isLoadable(defaults, "barbell", 45)).toBe(false);
    expect(isLoadable(defaults, "barbell", Number.NaN)).toBe(false);
  });

  it("rejects non-finite targets", () => {
    expect(() => roundToLoadable(defaults, "dumbbell", Number.NaN)).toThrow(
      RangeError,
    );
    expect(() => roundBandLevel(defaults, Infinity)).toThrow(RangeError);
  });
});

describe("other inventories", () => {
  const gym: Equipment = {
    dumbbells: { min: 2.5, max: 10, step: 2.5 },
    barbells: [40, 20, 20],
    bands: [],
    bar: 45,
    plates: [45, 25, 10, 5, 2.5],
    stackStep: 12.5,
  };

  it("lists dumbbells with fractional steps", () => {
    expect(availableLoads(gym, "dumbbell")).toEqual([2.5, 5, 7.5, 10]);
  });

  it("sorts and deduplicates fixed barbells", () => {
    expect(availableLoads(gym, "barbell")).toEqual([20, 40]);
  });

  it("loads the bar with plate pairs", () => {
    const loads = availableLoads(gym, "bar");
    expect(loads[0]).toBe(45);
    expect(loads.at(-1)).toBe(45 + 2 * 87.5);
    expect(loads).toContain(135);
    expect(loads).toContain(50);
    expect(loads).not.toContain(47.5);
    expect(roundToLoadable(gym, "bar", 137)).toBe(135);
  });

  it("rounds a stack to whole steps", () => {
    expect(roundToLoadable(gym, "stack", 40)).toBe(37.5);
    expect(roundToLoadable(gym, "stack", 3)).toBe(12.5);
    expect(roundToLoadable(gym, "stack", 3, "down")).toBeNull();
    expect(roundToLoadable(gym, "stack", 500, "up")).toBe(500);
    expect(isLoadable(gym, "stack", 25)).toBe(true);
    expect(isLoadable(gym, "stack", 0)).toBe(false);
  });

  it("has no bands", () => {
    expect(roundBandLevel(gym, 0)).toBeNull();
  });
});

// --- Properties (SPEC §5.6) --------------------------------------------------

/** Weights with up to two decimals, like 1.25 kg plates. */
const weight = fc.integer({ min: 1, max: 4000 }).map((n) => n / 20);
const step = fc.constantFrom(0.5, 1, 1.25, 2, 2.5, 5, 10);

const equipment: fc.Arbitrary<Equipment> = fc.record({
  dumbbells: fc.option(
    fc
      .tuple(weight, step, fc.integer({ min: 0, max: 40 }))
      .map(([min, s, count]) => ({ min, max: min + s * count, step: s })),
  ),
  barbells: fc.array(weight, { maxLength: 12 }),
  bands: fc.array(fc.string({ minLength: 1 }), { maxLength: 6 }),
  bar: fc.option(weight),
  plates: fc.array(weight, { maxLength: 8 }),
  stackStep: fc.option(step),
});
const implement = fc.constantFrom<WeightImplement>(
  "dumbbell",
  "barbell",
  "bar",
  "stack",
);
const listed = fc.constantFrom<ListedImplement>("dumbbell", "barbell", "bar");
const rounding = fc.constantFrom<Rounding>("nearest", "down", "up");
const target = fc.double({ min: -50, max: 500, noNaN: true });

describe("properties", () => {
  it("always returns a loadable weight", () => {
    fc.assert(
      fc.property(equipment, implement, target, rounding, (eq, imp, t, r) => {
        const load = roundToLoadable(eq, imp, t, r);
        return load === null || isLoadable(eq, imp, load);
      }),
    );
  });

  it("only returns listed loads, and nearest finds one whenever any exist", () => {
    fc.assert(
      fc.property(equipment, listed, target, rounding, (eq, imp, t, r) => {
        const loads = availableLoads(eq, imp);
        const load = roundToLoadable(eq, imp, t, r);
        if (load === null) return r !== "nearest" || loads.length === 0;
        return loads.includes(load);
      }),
    );
  });

  it("nearest is the closest load, down and up stay on their side", () => {
    fc.assert(
      fc.property(equipment, listed, target, (eq, imp, t) => {
        const loads = availableLoads(eq, imp);
        const nearest = roundToLoadable(eq, imp, t, "nearest");
        const down = roundToLoadable(eq, imp, t, "down");
        const up = roundToLoadable(eq, imp, t, "up");
        const milli = Math.round(t * 1000) / 1000;
        if (down !== null && down > milli) return false;
        if (up !== null && up < milli) return false;
        if (nearest === null) return loads.length === 0;
        const distance = Math.abs(nearest - milli);
        return loads.every((w) => Math.abs(w - milli) >= distance - 1e-9);
      }),
    );
  });

  it("round-trips every available load", () => {
    fc.assert(
      fc.property(equipment, listed, rounding, (eq, imp, r) =>
        availableLoads(eq, imp).every(
          (w) => roundToLoadable(eq, imp, w, r) === w,
        ),
      ),
    );
  });

  it("always returns a band from the inventory", () => {
    fc.assert(
      fc.property(equipment, target, rounding, (eq, level, r) => {
        const band = roundBandLevel(eq, level, r);
        if (band === null) return r !== "nearest" || eq.bands.length === 0;
        return eq.bands[band.level] === band.name;
      }),
    );
  });
});
