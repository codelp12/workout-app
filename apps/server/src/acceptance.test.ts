import { newId, sessionLogId } from "@workout-app/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { checkWeek, formatWeekCheck } from "./acceptance.js";
import { openDb, runMigrations, type Db } from "./db.js";
import { plannedSession, runLog, sessionLog, setLog } from "./schema.js";
import { OWNER_USER_ID } from "./sync.js";

let db: Db;
const sync = {
  userId: OWNER_USER_ID,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  serverSeq: 1,
};

beforeEach(() => {
  db = openDb(":memory:");
  runMigrations(db);
});

function plan(
  date: string,
  fields: Partial<typeof plannedSession.$inferInsert> = {},
) {
  const row = {
    ...sync,
    id: newId(),
    weekId: null,
    date,
    slot: "am" as const,
    modality: "lift" as const,
    workoutType: "push_a",
    templateId: null,
    intent: "key" as const,
    status: "planned" as const,
    generatedBy: "template",
    ...fields,
  };
  db.insert(plannedSession).values(row).run();
  return row;
}

function log(
  localDate: string,
  fields: Partial<typeof sessionLog.$inferInsert> = {},
) {
  const row = {
    ...sync,
    id: newId(),
    plannedSessionId: null,
    modality: "lift" as const,
    startedAt: 0,
    endedAt: 1,
    localDate,
    timezone: "America/New_York",
    rpe: null,
    notes: null,
    ...fields,
  };
  db.insert(sessionLog).values(row).run();
  return row;
}

const set = (sessionLogId: string, index: number, isWarmup = false) =>
  db
    .insert(setLog)
    .values({
      ...sync,
      id: newId(),
      sessionLogId,
      exerciseId: "bench",
      index,
      loadValue: 60,
      loadUnit: "lb",
      band: null,
      reps: 8,
      rir: 2,
      isWarmup,
      completedAt: 1,
    })
    .run();

describe("checkWeek", () => {
  it("matches planned sessions to their logs and flags what's missing", () => {
    const push = plan("2026-11-09");
    const run = plan("2026-11-10", { modality: "run", workoutType: "easy" });
    plan("2026-11-11", { workoutType: "pull_a" });
    plan("2026-11-12", { workoutType: "legs_a", status: "skipped" });
    plan("2026-11-16", { workoutType: "next_week" });
    const pushLog = log("2026-11-09", {
      id: sessionLogId(push.id),
      plannedSessionId: push.id,
    });
    set(pushLog.id, 0, true);
    set(pushLog.id, 0);
    set(pushLog.id, 1);
    const runLogRow = log("2026-11-10", {
      id: sessionLogId(run.id),
      plannedSessionId: run.id,
      modality: "run",
      endedAt: null,
    });
    db.insert(runLog)
      .values({
        ...sync,
        id: newId(),
        sessionLogId: runLogRow.id,
        workoutType: "easy",
        distanceValue: 3,
        distanceUnit: "mi",
        durationSec: 1500,
        avgHr: null,
        elevationValue: null,
        elevationUnit: null,
        rpe: 4,
        splits: [],
      })
      .run();
    log("2026-11-14", { modality: "climb" });
    log("2026-11-15", { deletedAt: 5 });

    const week = checkWeek(db, "2026-11-09");
    expect(
      week.sessions.map((s) => [
        s.date,
        s.title,
        s.status,
        s.sets,
        s.warmups,
        s.runs,
      ]),
    ).toEqual([
      ["2026-11-09", "push_a", "finished", 2, 1, 0],
      ["2026-11-10", "easy", "unfinished", 0, 0, 1],
      ["2026-11-11", "pull_a", "not logged", 0, 0, 0],
      ["2026-11-12", "legs_a", "skipped", 0, 0, 0],
      ["2026-11-14", "Unplanned climb", "finished", 0, 0, 0],
    ]);
    expect(week.duplicateSets).toEqual([]);
    expect(formatWeekCheck(week)).toContain(
      "4 planned sessions: 1 finished, 1 unfinished, 1 not logged, 1 skipped. 1 unplanned log.",
    );
  });

  it("finds a session moved into the week by its log", () => {
    const moved = plan("2026-11-02", { status: "moved" });
    log("2026-11-10", {
      id: sessionLogId(moved.id),
      plannedSessionId: moved.id,
    });
    expect(checkWeek(db, "2026-11-09").sessions).toMatchObject([
      { date: "2026-11-10", title: "push_a", status: "finished" },
    ]);
  });

  it("reports a set logged twice", () => {
    const push = plan("2026-11-09");
    const id = sessionLogId(push.id);
    log("2026-11-09", { id, plannedSessionId: push.id });
    set(id, 0);
    set(id, 0);
    set(id, 0, true);
    const week = checkWeek(db, "2026-11-09");
    expect(week.duplicateSets).toEqual([
      {
        title: "push_a",
        date: "2026-11-09",
        exercise: "bench",
        set: 1,
        warmup: false,
        times: 2,
      },
    ]);
    expect(formatWeekCheck(week)).toContain(
      "**Duplicate sets: 1**\n- 2026-11-09 push_a: bench set 1, 2 times",
    );
  });
});
