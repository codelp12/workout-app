import {
  SETTINGS_ID,
  defaultSettings,
  weekId,
  type PullResponse,
} from "@workout-app/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { setPassword } from "./auth.js";
import { openDb, runMigrations, type Db } from "./db.js";
import { planCurrentWeek } from "./plan.js";
import {
  block,
  plannedItem,
  plannedSession,
  settings,
  week,
} from "./schema.js";
import { seedExercises, seedTemplates } from "./seed.js";
import { OWNER_USER_ID } from "./sync.js";

let db: Db;

const ownerIn = (timezone: string) =>
  db
    .insert(settings)
    .values({
      ...defaultSettings(timezone, 0),
      userId: OWNER_USER_ID,
      serverSeq: 1,
    })
    .run();

const weeks = () =>
  db
    .select()
    .from(week)
    .all()
    .map((w) => [w.startDate, w.index, w.type]);

beforeEach(() => {
  db = openDb(":memory:");
  runMigrations(db);
});

describe("planCurrentWeek", () => {
  it("plans a week once, with the seeded templates", () => {
    seedExercises(db, 0);
    seedTemplates(db, 0);
    ownerIn("America/New_York");
    const now = Date.UTC(2026, 10, 4, 15); // Wed
    expect(planCurrentWeek(db, now)).toBe(true);
    expect(planCurrentWeek(db, now)).toBe(false);
    expect(planCurrentWeek(db, now + 86_400_000)).toBe(false);
    expect(weeks()).toEqual([["2026-11-02", 0, "loading"]]);
    expect(db.select().from(block).all()).toHaveLength(1);
    const sessions = db.select().from(plannedSession).all();
    expect(sessions).toHaveLength(11);
    expect(sessions.every((s) => s.weekId === weekId("2026-11-02"))).toBe(true);
    expect(db.select().from(plannedItem).all()).toHaveLength(41);
  });

  it.each([
    // Fall back: New York's Monday midnight is 05:00 UTC on 2026-11-02.
    [
      "America/New_York",
      Date.UTC(2026, 10, 2, 4, 59),
      Date.UTC(2026, 10, 2, 5),
    ],
    // Spring forward: 04:00 UTC on 2027-03-15.
    [
      "America/New_York",
      Date.UTC(2027, 2, 15, 3, 59),
      Date.UTC(2027, 2, 15, 4),
    ],
    // Auckland's Monday starts on Sunday, UTC.
    [
      "Pacific/Auckland",
      Date.UTC(2026, 10, 1, 10, 59),
      Date.UTC(2026, 10, 1, 11),
    ],
    ["Europe/London", Date.UTC(2026, 10, 1, 23, 59), Date.UTC(2026, 10, 2)],
  ])("rolls over at Sunday midnight in %s", (zone, before, after) => {
    ownerIn(zone);
    planCurrentWeek(db, before);
    expect(weeks()).toHaveLength(1);
    planCurrentWeek(db, after);
    const [first, second] = weeks();
    expect(second![1]).toBe(1);
    expect(second![0]).not.toBe(first![0]);
    planCurrentWeek(db, after + 60_000);
    expect(weeks()).toHaveLength(2);
  });

  it("uses the owner's zone once settings sync", () => {
    // 23:00 Sunday in New York is already Monday in UTC.
    const now = Date.UTC(2026, 10, 9, 4);
    ownerIn("America/New_York");
    planCurrentWeek(db, now);
    db.update(settings)
      .set({ timezone: "UTC" })
      .where(eq(settings.id, SETTINGS_ID))
      .run();
    planCurrentWeek(db, now);
    expect(weeks().map((w) => w[0])).toEqual(["2026-11-02", "2026-11-09"]);
  });
});

describe("rollover through sync", () => {
  it("plans on the first pull, and repeated pulls never duplicate it", async () => {
    const PASSWORD = "correct horse battery";
    let now = Date.UTC(2026, 10, 4, 15);
    const app = createApp(db, { now: () => now });
    await setPassword(db, PASSWORD);
    ownerIn("America/New_York");
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const pull = async (since: number) =>
      (await (
        await app.request(`/api/sync/pull?since=${since}&limit=1000`, {
          headers: { cookie },
        })
      ).json()) as PullResponse;

    const first = await pull(0);
    const entities = first.changes.map((c) => c.entity);
    expect(entities.filter((e) => e === "week")).toHaveLength(1);
    expect(entities.filter((e) => e === "planned_session")).toHaveLength(11);
    expect((await pull(first.cursor)).changes).toEqual([]);

    now = Date.UTC(2026, 10, 9, 5, 1); // Mon 00:01 in New York
    const next = await pull(first.cursor);
    expect(next.changes.filter((c) => c.entity === "week")).toHaveLength(1);
    expect((await pull(next.cursor)).changes).toEqual([]);
    expect(weeks()).toHaveLength(2);
  });
});
