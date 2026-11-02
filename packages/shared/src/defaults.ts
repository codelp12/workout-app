import type { DayAvailability, Equipment, Goals } from "./entities.js";
import type { UpsertData } from "./sync.js";

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

/** Every day, morning and evening, with gym access (SPEC §12 Q2). */
export const DEFAULT_AVAILABILITY: DayAvailability[] = [
  1, 2, 3, 4, 5, 6, 7,
].map((weekday) => ({ weekday, am: true, pm: true, gym: true }));

const DEFAULT_GOALS: Goals = { race: null, targetLifts: [] };

/**
 * The one settings row's id. Fixed, so every device edits the same row and
 * last-write-wins keeps a single copy (SPEC §3.2).
 */
export const SETTINGS_ID = "ca449776-3b67-4d1d-b98b-abe383b3bd28";

/**
 * Settings for a fresh install (SPEC §2): lb and miles, the default
 * inventory, every slot available, and the scheduler picking the lift-free
 * and long-run days.
 */
export function defaultSettings(
  timezone: string,
  now: number,
): UpsertData<"settings"> {
  return {
    id: SETTINGS_ID,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    weightUnit: "lb",
    distanceUnit: "mi",
    timezone,
    equipment: {
      ...DEFAULT_EQUIPMENT,
      dumbbells: DEFAULT_EQUIPMENT.dumbbells && {
        ...DEFAULT_EQUIPMENT.dumbbells,
      },
      barbells: [...DEFAULT_EQUIPMENT.barbells],
      bands: [...DEFAULT_EQUIPMENT.bands],
      plates: [...DEFAULT_EQUIPMENT.plates],
    },
    availability: DEFAULT_AVAILABILITY.map((day) => ({ ...day })),
    longRunDay: null,
    liftFreeDay: null,
    goals: { ...DEFAULT_GOALS, targetLifts: [] },
    engineConfig: {},
  };
}
