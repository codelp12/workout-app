import type { Equipment } from "./entities.js";

/**
 * The owner's starting inventory (SPEC §2), in lb: dumbbells 5–120 lb in 5 lb
 * steps, fixed barbells 20–110 lb in 10 lb steps, and four bands. Editable in
 * Settings.
 */
export const DEFAULT_EQUIPMENT: Equipment = {
  dumbbells: { min: 5, max: 120, step: 5 },
  barbells: [20, 30, 40, 50, 60, 70, 80, 90, 100, 110],
  bands: ["Light", "Medium", "Heavy", "Extra heavy"],
  bar: null,
  plates: [],
  stackStep: null,
};
