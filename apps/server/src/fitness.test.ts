import {
  MAIN_LIFTS,
  defaultSettings,
  fitnessStateId,
  newId,
  type PullResponse,
  type SyncOp,
} from "@workout-app/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { setPassword } from "./auth.js";
import { openDb, runMigrations, type Db } from "./db.js";
import { refreshFitnessState } from "./fitness.js";
import { fitnessState, sessionLog, setLog, settings } from "./schema.js";
import { OWNER_USER_ID } from "./sync.js";

const T0 = Date.UTC(2026, 10, 2, 15);
const [squat = ""] = MAIN_LIFTS.map((l) => l.exerciseId);
const sync = { userId: OWNER_USER_ID, serverSeq: 1, deletedAt: null };

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
  runMigrations(db);
});

const refresh = (now = T0) =>
  db.transaction((tx) => refreshFitnessState(tx, now));

const live = () =>
  db
    .select()
    .from(fitnessState)
    .all()
    .filter((r) => r.deletedAt === null)
    .map((r) => [r.date, r.value, r.unit, r.confidence]);

function onboard() {
  db.insert(settings)
    .values({
      ...defaultSettings("America/New_York", T0),
      ...sync,
      onboarding: {
        completedAt: T0,
        lifts: [
          {
            exerciseId: squat,
            load: { value: 50, unit: "lb" },
            reps: 8,
            rir: 2,
          },
        ],
        run: null,
        climb: null,
      },
    })
    .run();
}

function logSquat(localDate: string, load: number, reps: number, rir: number) {
  const sessionLogId = newId();
  db.insert(sessionLog)
    .values({
      ...sync,
      id: sessionLogId,
      createdAt: T0,
      updatedAt: T0,
      plannedSessionId: null,
      modality: "lift",
      startedAt: T0,
      endedAt: T0,
      localDate,
      timezone: "America/New_York",
      rpe: null,
      notes: null,
      checked: [],
    })
    .run();
  db.insert(setLog)
    .values({
      ...sync,
      id: newId(),
      createdAt: T0,
      updatedAt: T0,
      sessionLogId,
      exerciseId: squat,
      index: 0,
      loadValue: load,
      loadUnit: "lb",
      band: null,
      reps,
      rir,
      isWarmup: false,
      completedAt: T0,
    })
    .run();
  return sessionLogId;
}

describe("refreshFitnessState", () => {
  it("writes nothing without onboarding or logs", () => {
    expect(refresh()).toBe(0);
    expect(live()).toEqual([]);
  });

  it("writes one point per trained day, starting from onboarding", () => {
    onboard();
    logSquat("2026-11-04", 50, 10, 2);
    expect(refresh()).toBe(2);
    const onboarding = 50 * (1 + 10 / 30);
    expect(live()).toEqual([
      ["2026-11-02", onboarding, "lb", 0.3],
      // Calibration caps the rise at +1.5%.
      ["2026-11-04", onboarding * 1.015, "lb", expect.any(Number)],
    ]);
    expect(
      db
        .select()
        .from(fitnessState)
        .all()
        .map((r) => r.id),
    ).toContain(fitnessStateId("e1rm", squat, "2026-11-04"));
  });

  it("only rewrites rows that changed", () => {
    onboard();
    logSquat("2026-11-04", 50, 10, 2);
    refresh();
    expect(refresh()).toBe(0);
    logSquat("2026-11-06", 50, 10, 2);
    expect(refresh()).toBe(1);
  });

  it("tombstones points whose logs are gone", () => {
    onboard();
    logSquat("2026-11-04", 50, 10, 2);
    refresh();
    db.update(sessionLog).set({ deletedAt: T0 }).run();
    expect(refresh()).toBe(1);
    expect(live().map(([date]) => date)).toEqual(["2026-11-02"]);
  });
});

describe("fitness_state through sync", () => {
  it("refreshes after a lift log push and syncs the points down", async () => {
    const PASSWORD = "correct horse battery";
    const app = createApp(db, { now: () => T0, planWeeks: false });
    await setPassword(db, PASSWORD);
    onboard();
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const sessionLogId = newId();
    const base = { createdAt: T0, updatedAt: T0, deletedAt: null };
    const ops: SyncOp[] = [
      {
        opId: newId(),
        entity: "session_log",
        action: "upsert",
        data: {
          ...base,
          id: sessionLogId,
          plannedSessionId: null,
          modality: "lift",
          startedAt: T0,
          endedAt: T0,
          localDate: "2026-11-04",
          timezone: "America/New_York",
          rpe: null,
          notes: null,
          checked: [],
        },
      },
      {
        opId: newId(),
        entity: "set_log",
        action: "upsert",
        data: {
          ...base,
          id: newId(),
          sessionLogId,
          exerciseId: squat,
          index: 0,
          loadValue: 50,
          loadUnit: "lb",
          band: null,
          reps: 10,
          rir: 2,
          isWarmup: false,
          completedAt: T0,
        },
      },
    ] as SyncOp[];
    const res = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ops }),
    });
    expect(res.status).toBe(200);
    const pulled = (await (
      await app.request("/api/sync/pull?since=0&limit=1000", {
        headers: { cookie },
      })
    ).json()) as PullResponse;
    expect(
      pulled.changes.filter((c) => c.entity === "fitness_state"),
    ).toHaveLength(2);
  });
});
