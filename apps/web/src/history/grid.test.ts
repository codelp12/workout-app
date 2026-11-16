import "fake-indexeddb/auto";
import {
  blockId,
  newId,
  weekId,
  type Block,
  type PlannedItem,
  type PlannedSession,
  type Week,
} from "@workout-app/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { testExercise } from "../library/test-exercise";
import { openLocalDb } from "../sync/local-db";
import { gridSpan, readGrid } from "./grid";
import { rows } from "./test-rows";

const db = openLocalDb("grid-test");
const sync = {
  userId: 1,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  serverSeq: 1,
};
const units = { weightUnit: "lb", distanceUnit: "mi" } as const;
const WEEKS = ["2026-11-02", "2026-11-09"];

const block = (startDate: string, weekCount = 4): Block => ({
  id: blockId(startDate),
  ...sync,
  name: null,
  startDate,
  weekCount,
  engineVersion: "stub-1",
});
const week = (startDate: string, index: number, type: Week["type"]): Week => ({
  id: weekId(startDate),
  ...sync,
  blockId: blockId("2026-10-26"),
  index,
  startDate,
  type,
  engineVersion: "stub-1",
});
const item = (
  session: PlannedSession,
  targets: Record<string, unknown>,
  fields: Partial<PlannedItem> = {},
): PlannedItem => ({
  id: newId(),
  ...sync,
  plannedSessionId: session.id,
  position: 0,
  kind: "exercise",
  exerciseId: null,
  targets,
  reasons: [],
  ...fields,
});

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("gridSpan", () => {
  it("shows the block today falls in, with week types and neighbours", async () => {
    await db
      .rows("block")
      .bulkPut([block("2026-09-28"), block("2026-10-26"), block("2026-11-23")]);
    await db.rows("week").put(week("2026-11-16", 3, "deload"));
    const span = await gridSpan(db, "2026-11-11", null);
    expect(span.weeks.map((w) => [w.start, w.number, w.type])).toEqual([
      ["2026-10-26", 1, null],
      ["2026-11-02", 2, null],
      ["2026-11-09", 3, null],
      ["2026-11-16", 4, "deload"],
    ]);
    expect([span.earlier, span.later]).toEqual(["2026-09-28", "2026-11-23"]);
    const earlier = await gridSpan(db, "2026-11-11", "2026-09-28");
    expect(earlier.weeks[0]?.start).toBe("2026-09-28");
    expect(earlier.earlier).toBeNull();
  });

  it("falls back to the last four weeks with no blocks", async () => {
    const span = await gridSpan(db, "2026-11-11", null);
    expect(span.weeks.map((w) => w.start)).toEqual([
      "2026-10-19",
      "2026-10-26",
      "2026-11-02",
      "2026-11-09",
    ]);
  });
});

describe("readGrid", () => {
  it("puts each exercise's top working set beside its target, week by week", async () => {
    const bench = testExercise({ name: "Dumbbell Bench Press" });
    const curl = testExercise({ name: "Curl" });
    const planned = rows.planned({ date: "2026-11-03" });
    const target = {
      sets: 3,
      repMin: 6,
      repMax: 10,
      load: { value: 60, unit: "lb" },
      band: null,
      targetRir: 2,
      restSec: 150,
    };
    const early = rows.log({ localDate: "2026-11-03" });
    const late = rows.log({ localDate: "2026-11-10" });
    await db.rows("exercise").bulkPut([bench, curl]);
    await db.rows("planned_session").put(planned);
    await db
      .rows("planned_item")
      .put(item(planned, target, { exerciseId: bench.id }));
    await db.rows("session_log").bulkPut([early, late]);
    await db.rows("set_log").bulkPut([
      rows.set(early, { exerciseId: bench.id, loadValue: 60, reps: 10 }),
      rows.set(early, {
        exerciseId: bench.id,
        index: 1,
        loadValue: 30,
        loadUnit: "kg",
        reps: 8,
      }),
      rows.set(early, {
        exerciseId: bench.id,
        index: 2,
        loadValue: 90,
        isWarmup: true,
      }),
      rows.set(late, { exerciseId: bench.id, loadValue: 65, reps: 6 }),
      rows.set(late, {
        exerciseId: bench.id,
        index: 1,
        loadValue: 65,
        reps: 8,
      }),
      rows.set(late, { exerciseId: curl.id, loadValue: 20, deletedAt: 1 }),
      rows.set(late, {
        exerciseId: curl.id,
        index: 1,
        loadValue: null,
        loadUnit: null,
        reps: 12,
      }),
    ]);
    const { lift } = await readGrid(db, WEEKS, units);
    expect(lift.map((r) => r.name)).toEqual(["Dumbbell Bench Press", "Curl"]);
    const [benchRow, curlRow] = lift;
    expect(benchRow?.cells.map((c) => [c.top?.loadValue, c.top?.reps])).toEqual(
      [
        [30, 8],
        [65, 8],
      ],
    );
    expect(benchRow?.cells.map((c) => c.target?.sets ?? null)).toEqual([
      3,
      null,
    ]);
    expect(curlRow?.cells[1]?.top?.reps).toBe(12);
  });

  it("totals running and climbing per week against the plan", async () => {
    const plannedRun = rows.planned({
      modality: "run",
      workoutType: "easy",
      date: "2026-11-04",
    });
    const plannedClimb = rows.planned({
      modality: "climb",
      workoutType: "limit",
      date: "2026-11-05",
    });
    const run = rows.log({ modality: "run", localDate: "2026-11-04" });
    const kmRun = rows.log({ modality: "run", localDate: "2026-11-06" });
    const climb = rows.log({ modality: "climb", localDate: "2026-11-12" });
    await db.rows("planned_session").bulkPut([plannedRun, plannedClimb]);
    await db
      .rows("planned_item")
      .put(
        item(
          plannedRun,
          { distance: { value: 4, unit: "mi" } },
          { kind: "run_segment" },
        ),
      );
    await db.rows("session_log").bulkPut([run, kmRun, climb]);
    await db.rows("run_log").bulkPut([
      rows.run(run),
      rows.run(kmRun, {
        distanceValue: 8.04672,
        distanceUnit: "km",
        durationSec: 2400,
      }),
    ]);
    await db
      .rows("ascent")
      .bulkPut([
        rows.ascent(climb, { grade: "V4" }),
        rows.ascent(climb, { grade: "5.11a", style: "flash" }),
        rows.ascent(climb, { grade: "V6", style: "attempt", attempts: 4 }),
      ]);
    const grid = await readGrid(db, WEEKS, units);
    const [first] = grid.run;
    expect(first?.runs).toBe(2);
    expect(first?.planned).toBe(1);
    expect(first?.distance).toBeCloseTo(8.1);
    expect(first?.longest).toBeCloseTo(5);
    expect(first?.plannedDistance).toBe(4);
    expect(first?.durationSec).toBe(1581 + 2400);
    expect(grid.climb).toEqual([
      { sessions: 0, planned: 1, sends: 0, attempts: 0, hardest: [] },
      {
        sessions: 1,
        planned: 0,
        sends: 2,
        attempts: 6,
        hardest: ["V4", "5.11a"],
      },
    ]);
  });
});
