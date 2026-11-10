import { isLoadable, type WeightImplement } from "@workout-app/engine";
import {
  DEFAULT_EQUIPMENT,
  type Equipment,
  type WeightUnit,
} from "@workout-app/shared";
import { describe, expect, it } from "vitest";
import { testExercise } from "../library/test-exercise";
import type { LiftTargets } from "../plan/sessions";
import {
  bandChoices,
  loadChoices,
  prefill,
  settle,
  type LiftCard,
} from "./lift-log";

const targets = (fields: Partial<LiftTargets> = {}): LiftTargets => ({
  sets: 3,
  load: null,
  band: null,
  repMin: 8,
  repMax: 12,
  targetRir: 2,
  restSec: 90,
  ...fields,
});

const card = (
  equipment: string[],
  fields: Partial<LiftTargets> = {},
): LiftCard => ({
  itemId: "item",
  exercise: testExercise({ equipment }),
  targets: targets(fields),
  sets: [],
  lastTime: [],
});

const settingsFor = (equipment: Equipment, weightUnit: WeightUnit = "lb") => ({
  equipment,
  weightUnit,
  timezone: "UTC",
});

const inventories: Record<string, Equipment> = {
  default: DEFAULT_EQUIPMENT,
  "kg rack with plates": {
    ...DEFAULT_EQUIPMENT,
    dumbbells: { min: 2, max: 32, step: 2 },
    barbells: [15, 25],
    bar: 20,
    plates: [1.25, 2.5, 5, 10],
    stackStep: 2.5,
  },
  "odd steps": {
    ...DEFAULT_EQUIPMENT,
    dumbbells: { min: 7.5, max: 52.5, step: 2.5 },
    barbells: [33, 47],
    bar: 45,
    plates: [2.5, 2.5, 10, 25],
    stackStep: 7,
  },
};

const implements_: Record<string, WeightImplement> = {
  dumbbell: "dumbbell",
  barbell: "barbell",
  cable: "stack",
};

const loadable = (
  equipment: Equipment,
  implement: WeightImplement,
  load: number,
) =>
  implement === "barbell"
    ? isLoadable(equipment, "barbell", load) ||
      isLoadable(equipment, "bar", load)
    : isLoadable(equipment, implement, load);

describe("load picker choices", () => {
  for (const [name, equipment] of Object.entries(inventories)) {
    for (const [kind, implement] of Object.entries(implements_)) {
      it(`never offers or prefills an unloadable ${kind} weight (${name})`, () => {
        const settings = settingsFor(equipment);
        for (let target = 0; target <= 300; target += 0.75) {
          for (const unit of ["lb", "kg"] as const) {
            const c = card([kind], { load: { value: target, unit } });
            const { load } = prefill(c, settings);
            const choices = loadChoices(c, settings, load)!;
            const draft = settle(c, settings, {
              load: target,
              band: null,
              reps: 8,
              rir: null,
            });
            if (choices.length === 0) {
              // e.g. no stack step configured: nothing to offer.
              expect([load, draft.load]).toEqual([null, null]);
              continue;
            }
            expect(loadable(equipment, implement, load!)).toBe(true);
            expect(choices).toContain(load);
            for (const choice of choices) {
              expect(loadable(equipment, implement, choice)).toBe(true);
            }
            expect(loadable(equipment, implement, draft.load!)).toBe(true);
          }
        }
      });
    }
  }

  it("lists the rack, fixed barbells plus the bar's loads, and stack steps", () => {
    const settings = settingsFor(inventories["kg rack with plates"]!, "kg");
    expect(loadChoices(card(["dumbbell"]), settings, 10)).toEqual([
      2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32,
    ]);
    const barbell = loadChoices(card(["barbell"]), settings, 20)!;
    expect(barbell.slice(0, 4)).toEqual([15, 20, 22.5, 25]);
    expect(barbell.at(-1)).toBe(20 + 2 * (1.25 + 2.5 + 5 + 10));
    const stack = loadChoices(card(["cable"]), settings, 10)!;
    expect(stack.slice(0, 3)).toEqual([2.5, 5, 7.5]);
    expect(stack).toHaveLength(50);
    expect(loadChoices(card(["cable"]), settings, 200)!.at(-1)).toBe(225);
  });

  it("snaps to the nearest load, the lighter on a tie", () => {
    const settings = settingsFor(DEFAULT_EQUIPMENT);
    const at = (value: number) =>
      prefill(card(["dumbbell"], { load: { value, unit: "lb" } }), settings)
        .load;
    expect(at(52)).toBe(50);
    expect(at(52.5)).toBe(50);
    expect(at(53)).toBe(55);
    expect(at(0)).toBe(5);
    expect(at(500)).toBe(120);
  });

  it("offers nothing when the inventory lacks the implement", () => {
    const settings = settingsFor({
      ...DEFAULT_EQUIPMENT,
      dumbbells: null,
      barbells: [],
    });
    for (const kind of ["dumbbell", "barbell", "cable"]) {
      const c = card([kind], { load: { value: 50, unit: "lb" } });
      expect(loadChoices(c, settings, 50)).toEqual([]);
      expect(prefill(c, settings).load).toBeNull();
    }
  });

  it("leaves weights the inventory doesn't model to the plain stepper", () => {
    const settings = settingsFor(DEFAULT_EQUIPMENT);
    const c = card(["kettlebell"], { load: { value: 53, unit: "lb" } });
    expect(loadChoices(c, settings, 53)).toBeNull();
    expect(prefill(c, settings).load).toBe(53);
  });

  it("offers only the inventory's bands", () => {
    const settings = settingsFor(DEFAULT_EQUIPMENT);
    const band = card(["band"]);
    expect(bandChoices(band, settings)).toEqual(DEFAULT_EQUIPMENT.bands);
    expect(prefill(band, settings)).toMatchObject({
      load: null,
      band: "Light",
    });
    expect(prefill(card(["band"], { band: "Heavy" }), settings).band).toBe(
      "Heavy",
    );
    expect(prefill(card(["band"], { band: "Purple" }), settings).band).toBe(
      "Light",
    );
    expect(bandChoices(card(["dumbbell"]), settings)).toBeNull();
  });
});
