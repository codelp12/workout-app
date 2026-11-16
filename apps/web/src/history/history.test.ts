import "fake-indexeddb/auto";
import { newId, type Template } from "@workout-app/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { testExercise } from "../library/test-exercise";
import { openLocalDb } from "../sync/local-db";
import { readHistory, readHistoryDetail, sessionFacts } from "./history";
import { rows } from "./test-rows";

const db = openLocalDb("history-test");

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

const pushA: Template = {
  id: newId(),
  userId: 1,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  serverSeq: 1,
  name: "Push A",
  modality: "lift",
  intensityClass: "heavy",
  intent: "support",
  slots: [],
};

describe("readHistory", () => {
  it("lists every modality newest first, titled from the plan", async () => {
    const planned = rows.planned({ templateId: pushA.id });
    const lift = rows.log({ plannedSessionId: planned.id });
    const run = rows.log({ modality: "run", localDate: "2026-11-10" });
    const climb = rows.log({
      modality: "climb",
      localDate: "2026-11-10",
      startedAt: 10,
      endedAt: 10 + 90 * 60_000,
    });
    const gone = rows.log({ deletedAt: 5, localDate: "2026-11-11" });
    await db.rows("template").put(pushA);
    await db.rows("planned_session").put(planned);
    await db.rows("session_log").bulkPut([lift, run, climb, gone]);
    await db
      .rows("set_log")
      .bulkPut([
        rows.set(lift, { exerciseId: "a", index: 0 }),
        rows.set(lift, { exerciseId: "a", index: 1 }),
        rows.set(lift, { exerciseId: "b", index: 0 }),
        rows.set(lift, { exerciseId: "b", isWarmup: true }),
        rows.set(lift, { exerciseId: "b", index: 1, deletedAt: 3 }),
      ]);
    await db.rows("run_log").put(rows.run(run));
    await db
      .rows("ascent")
      .bulkPut([
        rows.ascent(climb, { grade: "V2" }),
        rows.ascent(climb, { grade: "V5", style: "flash" }),
        rows.ascent(climb, { grade: "V7", style: "attempt", attempts: 3 }),
      ]);

    const history = await readHistory(db);
    expect(history.map((e) => [e.title, e.summary])).toEqual([
      ["Climbing session", "2 sends · hardest V5 · 90 min"],
      ["Easy run", "3.1 mi · 26:21 · 8:30 /mi · RPE 4"],
      ["Push A", "2 exercises · 3 sets · 45 min"],
    ]);
  });

  it("keeps an unfinished session, without a duration", async () => {
    const log = rows.log({ endedAt: null });
    await db.rows("session_log").put(log);
    const [entry] = await readHistory(db);
    expect(entry?.summary).toBe("No sets logged");
    expect(sessionFacts(entry!.log)).toBe("Not finished");
  });

  it("names the hardest send on each grade scale", async () => {
    const climb = rows.log({ modality: "climb", endedAt: null });
    await db.rows("session_log").put(climb);
    await db
      .rows("ascent")
      .bulkPut([
        rows.ascent(climb, { grade: "V4" }),
        rows.ascent(climb, { grade: "5.10a" }),
      ]);
    const [entry] = await readHistory(db);
    expect(entry?.summary).toBe("2 sends · hardest V4, 5.10a");
  });
});

describe("readHistoryDetail", () => {
  it("groups sets by exercise in the order they were done", async () => {
    const bench = testExercise({ name: "Bench Press" });
    const row = testExercise({ name: "Dumbbell Row" });
    const log = rows.log({ rpe: 8, notes: "Good" });
    await db.rows("exercise").bulkPut([bench, row]);
    await db.rows("session_log").put(log);
    await db
      .rows("set_log")
      .bulkPut([
        rows.set(log, { exerciseId: row.id, index: 0, completedAt: 30 }),
        rows.set(log, { exerciseId: bench.id, index: 1, completedAt: 20 }),
        rows.set(log, { exerciseId: bench.id, index: 0, completedAt: 10 }),
        rows.set(log, { exerciseId: bench.id, isWarmup: true, completedAt: 5 }),
      ]);

    const detail = await readHistoryDetail(db, log.id);
    expect(
      detail?.exercises.map((e) => [
        e.name,
        e.sets.map((s) => s.index),
        e.warmups.length,
      ]),
    ).toEqual([
      ["Bench Press", [0, 1], 1],
      ["Dumbbell Row", [0], 0],
    ]);
    expect(sessionFacts(detail!.log)).toBe("45 min · RPE 8");
  });

  it("uses the latest run and names the climbs' projects", async () => {
    const run = rows.log({ modality: "run" });
    const climb = rows.log({ modality: "climb" });
    const projectId = newId();
    await db.rows("session_log").bulkPut([run, climb]);
    await db
      .rows("run_log")
      .bulkPut([
        rows.run(run, { distanceValue: 2, updatedAt: 1 }),
        rows.run(run, { distanceValue: 3, updatedAt: 2 }),
      ]);
    await db.rows("project").put({
      id: projectId,
      userId: 1,
      createdAt: 0,
      updatedAt: 0,
      deletedAt: null,
      serverSeq: 1,
      name: "Roof",
      grade: "V5",
      status: "active",
      sentAt: null,
      notes: null,
    });
    await db.rows("ascent").put(rows.ascent(climb, { projectId }));

    expect((await readHistoryDetail(db, run.id))?.run?.distanceValue).toBe(3);
    const detail = await readHistoryDetail(db, climb.id);
    expect(detail?.projectNames.get(projectId)).toBe("Roof");
  });

  it("is null for a deleted or unknown log", async () => {
    const log = rows.log({ deletedAt: 1 });
    await db.rows("session_log").put(log);
    expect(await readHistoryDetail(db, log.id)).toBeNull();
    expect(await readHistoryDetail(db, newId())).toBeNull();
  });
});
