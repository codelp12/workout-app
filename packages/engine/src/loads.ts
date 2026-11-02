import type { Equipment } from "@workout-app/shared";

/**
 * Implements loaded by weight, all in the inventory's unit:
 * - `dumbbell`: one dumbbell from the rack (per hand).
 * - `barbell`: a fixed-weight barbell.
 * - `bar`: the optional loadable bar, with plates in pairs (one per side).
 * - `stack`: a cable or machine stack, in whole steps with no upper limit.
 *
 * Bands are levels, not weights; see {@link roundBandLevel}.
 */
export type WeightImplement = "dumbbell" | "barbell" | "bar" | "stack";

/** Implements with a finite list of loads. */
export type ListedImplement = Exclude<WeightImplement, "stack">;

/**
 * `nearest` picks the closest load, the lighter one on a tie (slow to
 * increase, SPEC §5.0). `down` and `up` never cross the target and give
 * `null` when nothing lies on that side.
 */
export type Rounding = "nearest" | "down" | "up";

// Weights are compared in thousandths so 2.5 + 2.5 + 1.25 and the like are exact.
const SCALE = 1000;
const toMilli = (weight: number) => Math.round(weight * SCALE);
const fromMilli = (milli: number) => milli / SCALE;

/**
 * Every load the inventory can make on a listed implement, lightest first,
 * without duplicates. Bar loads include the bar.
 */
export function availableLoads(
  equipment: Equipment,
  implement: ListedImplement,
): number[] {
  return listMilli(equipment, implement).map(fromMilli);
}

/** Whether the inventory can make exactly `weight` on `implement`. */
export function isLoadable(
  equipment: Equipment,
  implement: WeightImplement,
  weight: number,
): boolean {
  if (!Number.isFinite(weight)) return false;
  const target = toMilli(weight);
  if (implement === "stack") {
    const step = stackStepMilli(equipment);
    return step !== null && target >= step && target % step === 0;
  }
  return listMilli(equipment, implement).includes(target);
}

/**
 * Round `target` to a load the inventory can make on `implement`. `null`
 * when the inventory has none, or none on the requested side of `target`.
 */
export function roundToLoadable(
  equipment: Equipment,
  implement: WeightImplement,
  target: number,
  rounding: Rounding = "nearest",
): number | null {
  if (!Number.isFinite(target)) {
    throw new RangeError(`Target must be a finite number, got ${target}`);
  }
  const milli = toMilli(target);
  const rounded =
    implement === "stack"
      ? roundStack(stackStepMilli(equipment), milli, rounding)
      : roundListed(listMilli(equipment, implement), milli, rounding);
  return rounded === null ? null : fromMilli(rounded);
}

/** A band from the inventory: its index (0 is the lightest) and name. */
export interface BandLevel {
  level: number;
  name: string;
}

/**
 * Round a band level (0 = lightest, may be fractional) to a band in the
 * inventory, with the same rules as {@link roundToLoadable}.
 */
export function roundBandLevel(
  equipment: Equipment,
  level: number,
  rounding: Rounding = "nearest",
): BandLevel | null {
  if (!Number.isFinite(level)) {
    throw new RangeError(`Level must be a finite number, got ${level}`);
  }
  const levels = equipment.bands.map((_, index) => index);
  const rounded = roundListed(levels, level, rounding);
  if (rounded === null) return null;
  return { level: rounded, name: equipment.bands[rounded] ?? "" };
}

function listMilli(equipment: Equipment, implement: ListedImplement): number[] {
  switch (implement) {
    case "dumbbell": {
      const rack = equipment.dumbbells;
      if (rack === null) return [];
      const min = toMilli(rack.min);
      const max = toMilli(rack.max);
      const step = Math.max(1, toMilli(rack.step));
      const loads: number[] = [];
      for (let weight = min; weight <= max; weight += step) loads.push(weight);
      return loads;
    }
    case "barbell":
      return sortedUnique(equipment.barbells.map(toMilli));
    case "bar": {
      if (equipment.bar === null) return [];
      const bar = toMilli(equipment.bar);
      let pairSums = new Set([0]);
      for (const plate of equipment.plates) {
        const pair = 2 * toMilli(plate);
        pairSums = new Set([
          ...pairSums,
          ...[...pairSums].map((s) => s + pair),
        ]);
      }
      return sortedUnique([...pairSums].map((sum) => bar + sum));
    }
  }
}

function stackStepMilli(equipment: Equipment): number | null {
  const step = equipment.stackStep;
  return step === null ? null : Math.max(1, toMilli(step));
}

function roundStack(
  step: number | null,
  target: number,
  rounding: Rounding,
): number | null {
  if (step === null) return null;
  const below = Math.floor(target / step) * step;
  const above = Math.ceil(target / step) * step;
  if (rounding === "down") return below >= step ? below : null;
  if (rounding === "up") return Math.max(step, above);
  if (below < step) return step;
  return target - below <= above - target ? below : above;
}

/** `loads` is sorted ascending. */
function roundListed(
  loads: readonly number[],
  target: number,
  rounding: Rounding,
): number | null {
  let below: number | null = null;
  let above: number | null = null;
  for (const load of loads) {
    if (load <= target) below = load;
    if (load >= target) {
      above = load;
      break;
    }
  }
  if (rounding === "down") return below;
  if (rounding === "up") return above;
  if (below === null) return above;
  if (above === null) return below;
  return target - below <= above - target ? below : above;
}

function sortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}
