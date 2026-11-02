import type { DistanceUnit, Weight, WeightUnit } from "@workout-app/shared";

const LB_PER_KG = 2.20462262;
const KM_PER_MI = 1.609344;

export type Distance = { value: number; unit: DistanceUnit };

export function toWeightUnit(weight: Weight, unit: WeightUnit): number {
  if (weight.unit === unit) return weight.value;
  return unit === "lb" ? weight.value * LB_PER_KG : weight.value / LB_PER_KG;
}

export function toDistanceUnit(distance: Distance, unit: DistanceUnit): number {
  if (distance.unit === unit) return distance.value;
  return unit === "km"
    ? distance.value * KM_PER_MI
    : distance.value / KM_PER_MI;
}

/** `60 lb`, `27.5 kg`, `3.1 mi`. */
export function formatAmount(value: number, unit: string): string {
  return `${Math.round(value * 100) / 100} ${unit}`;
}
