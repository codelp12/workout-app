import "fake-indexeddb/auto";
import { planWeek } from "@workout-app/engine";
import {
  DEFAULT_AVAILABILITY,
  DEFAULT_EQUIPMENT,
  SETTINGS_ID,
  defaultSettings,
  weekId,
  type EntityName,
} from "@workout-app/shared";
import { describe, expect, it } from "vitest";
import { device, fakeServer } from "../sync/test-helpers";
import { planProvisionalWeek } from "./provisional";

const NOW = Date.UTC(2026, 10, 4, 15); // Wed 2026-11-04
const MONDAY = "2026-11-02";

describe("provisional week", () => {
  it("is planned once, without touching the outbox", async () => {
    const { db } = device(fakeServer());
    await db.rows("settings").put({
      ...defaultSettings("America/New_York", 0),
      userId: 1,
      serverSeq: 1,
    });
    expect(await planProvisionalWeek(db, NOW)).toBe(true);
    expect(await planProvisionalWeek(db, NOW)).toBe(false);
    expect(await db.rows("week").get(weekId(MONDAY))).toMatchObject({
      serverSeq: 0,
      type: "loading",
    });
    expect(await db.rows("planned_session").count()).toBe(11);
    expect(await db.outbox.count()).toBe(0);
  });

  it("is replaced by the server's week on pull", async () => {
    const server = fakeServer();
    const { db, engine } = device(server);
    await db
      .rows("settings")
      .put({ ...defaultSettings("UTC", 0), userId: 1, serverSeq: 1 });
    await planProvisionalWeek(db, NOW);
    expect(await db.rows("planned_item").count()).toBe(5);

    // The server planned the same week with an older block and a template
    // for Push A, so its rows differ from the phone's.
    const blockStart = "2026-10-26";
    const older = planWeek({
      weekStart: blockStart,
      now: 1,
      blocks: [],
      settings: {
        weightUnit: "lb",
        distanceUnit: "mi",
        equipment: DEFAULT_EQUIPMENT,
        availability: DEFAULT_AVAILABILITY,
        onboarding: null,
      },
      templates: [],
      exercises: [],
      logs: { lift: [], run: [], climb: [] },
    });
    const serverPlan = planWeek({
      weekStart: MONDAY,
      now: 2,
      blocks: [older.block!],
      settings: {
        weightUnit: "lb",
        distanceUnit: "mi",
        equipment: DEFAULT_EQUIPMENT,
        availability: DEFAULT_AVAILABILITY,
        onboarding: null,
      },
      templates: [],
      exercises: [],
      logs: { lift: [], run: [], climb: [] },
    });
    serverPlan.items = serverPlan.items.slice(0, 3);
    let seq = 100;
    const add = (entity: EntityName, row: object) =>
      server.rows.set((row as { id: string }).id, {
        entity,
        row: { ...row, userId: 1, serverSeq: ++seq } as never,
      });
    add("block", older.block!);
    add("week", serverPlan.week);
    for (const s of serverPlan.sessions) add("planned_session", s);
    for (const i of serverPlan.items) add("planned_item", i);

    await engine.sync();
    expect(await db.rows("week").get(weekId(MONDAY))).toMatchObject({
      blockId: older.block!.id,
      index: 1,
    });
    const blocks = await db.rows("block").toArray();
    expect(blocks.map((b) => b.startDate)).toEqual([blockStart]);
    const sessions = await db.rows("planned_session").toArray();
    expect(sessions).toHaveLength(11);
    expect(sessions.every((s) => s.serverSeq > 0)).toBe(true);
    const items = await db.rows("planned_item").toArray();
    expect(items.map((i) => i.id).sort()).toEqual(
      serverPlan.items.map((i) => i.id).sort(),
    );
    expect(await planProvisionalWeek(db, NOW)).toBe(false);
  });

  it("plans in the device's zone before settings exist", async () => {
    const { db } = device(fakeServer());
    expect(await db.rows("settings").get(SETTINGS_ID)).toBeUndefined();
    expect(await planProvisionalWeek(db, NOW)).toBe(true);
    expect(await db.rows("week").count()).toBe(1);
  });
});
