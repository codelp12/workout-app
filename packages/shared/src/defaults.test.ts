import { describe, expect, it } from "vitest";
import { DEFAULT_EQUIPMENT, defaultSettings, SETTINGS_ID } from "./defaults.js";
import { upsertDataSchemas } from "./sync.js";

describe("defaultSettings", () => {
  it("is a valid settings upsert with the SPEC §2 defaults", () => {
    const settings = defaultSettings("America/New_York", 1000);
    expect(upsertDataSchemas.settings.parse(settings)).toEqual(settings);
    expect(settings).toMatchObject({
      id: SETTINGS_ID,
      weightUnit: "lb",
      distanceUnit: "mi",
      timezone: "America/New_York",
      equipment: DEFAULT_EQUIPMENT,
      liftFreeDay: null,
      longRunDay: null,
    });
    expect(settings.availability).toHaveLength(7);
    expect(settings.availability.every((d) => d.am && d.pm && d.gym)).toBe(
      true,
    );
  });

  it("returns copies, so edits never change the defaults", () => {
    const settings = defaultSettings("UTC", 0);
    settings.equipment.barbells.push(500);
    settings.equipment.dumbbells!.max = 200;
    settings.availability[0]!.am = false;
    const fresh = defaultSettings("UTC", 0);
    expect(fresh.equipment).toEqual(DEFAULT_EQUIPMENT);
    expect(fresh.equipment.dumbbells?.max).toBe(120);
    expect(fresh.availability[0]?.am).toBe(true);
  });
});
