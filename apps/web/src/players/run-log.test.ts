import "fake-indexeddb/auto";
import { newId, sessionLogId, type PlannedSession } from "@workout-app/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionView } from "../plan/sessions";
import { openLocalDb } from "../sync/local-db";
import {
  durationOf,
  formatDuration,
  formatPace,
  logRun,
  paceSec,
  parseNumber,
  readRunSession,
} from "./run-log";

describe("pace", () => {
  it("is duration over distance", () => {
    expect(paceSec(3.1, 1581)).toBeCloseTo(510);
    expect(formatPace(paceSec(3.1, 1581)!, "mi")).toBe("8:30 /mi");
    expect(formatPace(paceSec(5, 1500)!, "km")).toBe("5:00 /km");
  });

  it("needs a distance and a duration over zero", () => {
    expect(paceSec(null, 600)).toBeNull();
    expect(paceSec(0, 600)).toBeNull();
    expect(paceSec(2, null)).toBeNull();
    expect(paceSec(2, 0)).toBeNull();
  });

  it("rounds to the second, carrying into the minute", () => {
    expect(formatPace(599.6, "mi")).toBe("10:00 /mi");
  });
});

describe("durations", () => {
  it("adds minutes and seconds, either blank", () => {
    expect(durationOf("45", "30")).toBe(2730);
    expect(durationOf("95", "")).toBe(5700);
    expect(durationOf("", "50")).toBe(50);
    expect(durationOf("", "")).toBeNull();
    expect(durationOf("-1", "0")).toBeNull();
  });

  it("formats with hours only when needed", () => {
    expect(formatDuration(2730)).toBe("45:30");
    expect(formatDuration(3905)).toBe("1:05:05");
    expect(formatDuration(59)).toBe("0:59");
  });

  it("parses numbers with a decimal comma", () => {
    expect(parseNumber(" 3,1 ")).toBe(3.1);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
  });
});

describe("logRun", () => {
  const db = openLocalDb("run-log-test");
  const session: PlannedSession = {
    id: newId(),
    userId: 1,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    serverSeq: 1,
    weekId: null,
    date: "2026-11-10",
    slot: "am",
    modality: "run",
    workoutType: "easy",
    templateId: null,
    intent: "support",
    status: "planned",
    generatedBy: "engine@stub-1",
  };
  const view = { session } as SessionView;

  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it("writes a finished session log and its run to the outbox", async () => {
    const now = Date.UTC(2026, 10, 10, 13);
    await logRun(
      db,
      view,
      {
        workoutType: "easy",
        distance: 3.1,
        durationSec: 1581,
        avgHr: 148,
        elevation: 120,
        rpe: 4,
        splits: [{ distanceValue: 1, durationSec: 500 }],
        notes: " Nice ",
      },
      { distanceUnit: "mi", timezone: "America/New_York" },
      now,
    );
    const { log, run } = await readRunSession(db, session.id);
    expect(log).toMatchObject({
      id: sessionLogId(session.id),
      plannedSessionId: session.id,
      modality: "run",
      startedAt: now - 1581_000,
      endedAt: now,
      localDate: "2026-11-10",
      rpe: 4,
      notes: "Nice",
    });
    expect(run).toMatchObject({
      sessionLogId: log!.id,
      workoutType: "easy",
      distanceValue: 3.1,
      distanceUnit: "mi",
      durationSec: 1581,
      avgHr: 148,
      elevationValue: 120,
      elevationUnit: "ft",
      rpe: 4,
      splits: [{ distanceValue: 1, durationSec: 500 }],
    });
    const ops = await db.outbox.toArray();
    expect(ops.map((op) => op.entity)).toEqual(["session_log", "run_log"]);
  });

  it("leaves the elevation unit empty without an elevation", async () => {
    await logRun(
      db,
      view,
      {
        workoutType: "easy",
        distance: 5,
        durationSec: 1500,
        avgHr: null,
        elevation: null,
        rpe: 3,
        splits: [],
        notes: null,
      },
      { distanceUnit: "km", timezone: "UTC" },
    );
    const { run } = await readRunSession(db, session.id);
    expect(run).toMatchObject({
      distanceUnit: "km",
      elevationValue: null,
      elevationUnit: null,
      avgHr: null,
    });
  });
});
