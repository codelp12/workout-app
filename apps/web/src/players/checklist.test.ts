import "fake-indexeddb/auto";
import {
  defaultChecklistId,
  newId,
  sessionLogId,
  type PlannedSession,
} from "@workout-app/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionView } from "../plan/sessions";
import { openLocalDb } from "../sync/local-db";
import {
  checklistSessionType,
  readChecklist,
  toggleChecked,
  toggleStretchChecked,
} from "./checklist";
import { finishSession } from "./lift-log";

const sync = {
  userId: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  serverSeq: 1,
};

function plannedSession(fields: Partial<PlannedSession> = {}): PlannedSession {
  return {
    id: newId(),
    ...sync,
    weekId: null,
    date: "2026-11-17",
    slot: "pm",
    modality: "lift",
    workoutType: "push_a",
    templateId: null,
    intent: "support",
    status: "planned",
    generatedBy: "manual",
    ...fields,
  };
}

const viewOf = (session: PlannedSession): SessionView => ({
  session,
  planned: { date: session.date, slot: session.slot },
  inProgress: false,
  title: "Push A",
  items: [],
  exerciseNames: new Map(),
});

describe("checklistSessionType", () => {
  it("maps lifts by family and runs and climbs by modality", () => {
    expect(checklistSessionType(plannedSession())).toBe("push");
    expect(
      checklistSessionType(plannedSession({ workoutType: "pull_b" })),
    ).toBe("pull");
    expect(
      checklistSessionType(plannedSession({ workoutType: "legs_a" })),
    ).toBe("legs");
    expect(
      checklistSessionType(
        plannedSession({ modality: "run", workoutType: "easy" }),
      ),
    ).toBe("run");
    expect(
      checklistSessionType(
        plannedSession({ modality: "climb", workoutType: "limit" }),
      ),
    ).toBe("climb");
    expect(
      checklistSessionType(plannedSession({ workoutType: "custom" })),
    ).toBeNull();
    expect(
      checklistSessionType(plannedSession({ modality: "mobility" })),
    ).toBeNull();
  });
});

describe("warm-up checklist", () => {
  const db = openLocalDb("checklist-test");
  const items = [
    { id: "arm-circles", name: "Arm circles", detail: "10 each direction" },
    { id: "wall-slides", name: "Wall slides", detail: null },
  ];

  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    await db.rows("checklist").bulkPut([
      {
        id: defaultChecklistId("warmup", "push"),
        ...sync,
        kind: "warmup",
        sessionType: "push",
        items,
      },
      { id: newId(), ...sync, kind: "warmup", sessionType: "pull", items: [] },
      {
        id: newId(),
        ...sync,
        deletedAt: 5,
        kind: "warmup",
        sessionType: "legs",
        items,
      },
      {
        id: defaultChecklistId("stretch", "push"),
        ...sync,
        updatedAt: 8,
        kind: "stretch",
        sessionType: "push",
        items: [
          {
            id: "stretch-shoulder",
            name: "Shoulder stretch",
            detail: "20–30 s per side",
          },
        ],
      },
    ]);
  });

  it("reads the live list for the session's type and requested kind", async () => {
    expect(
      (await readChecklist(db, plannedSession(), "warmup"))?.items,
    ).toEqual(items);
    expect(
      await readChecklist(
        db,
        plannedSession({ workoutType: "legs_a" }),
        "warmup",
      ),
    ).toBeNull();
    expect(
      await readChecklist(
        db,
        plannedSession({ workoutType: "custom" }),
        "warmup",
      ),
    ).toBeNull();
    expect(
      (await readChecklist(db, plannedSession(), "stretch"))?.items.map(
        (item) => item.id,
      ),
    ).toEqual(["stretch-shoulder"]);
  });

  it("starts the log on the first tick and keeps it through untick", async () => {
    const session = plannedSession();
    const view = viewOf(session);
    const id = sessionLogId(session.id);
    await toggleChecked(db, view, "arm-circles", "America/New_York", 1000);
    const started = await db.rows("session_log").get(id);
    expect(started).toMatchObject({
      modality: "lift",
      startedAt: 1000,
      endedAt: null,
      checked: ["arm-circles"],
    });
    await toggleChecked(db, view, "wall-slides", "America/New_York", 2000);
    await toggleChecked(db, view, "arm-circles", "America/New_York", 3000);
    expect(await db.rows("session_log").get(id)).toMatchObject({
      startedAt: 1000,
      checked: ["wall-slides"],
    });
    expect(await db.outbox.count()).toBe(3);
  });

  it("adds and removes stretch ticks without changing the finished session or warm-up ticks", async () => {
    const view = viewOf(plannedSession());
    const id = sessionLogId(view.session.id);
    await toggleChecked(db, view, "arm-circles", "UTC", 1000);
    await finishSession(db, view, { rpe: 7, notes: "Felt strong" }, 2000);
    const finished = await db.rows("session_log").get(id);

    await Promise.all([
      toggleStretchChecked(db, id, "stretch-doorway", 3000),
      toggleStretchChecked(db, id, "stretch-shoulder", 3000),
    ]);
    expect(await db.rows("session_log").get(id)).toEqual({
      ...finished,
      updatedAt: 3000,
      checked: ["arm-circles", "stretch-doorway", "stretch-shoulder"],
    });
    await toggleStretchChecked(db, id, "stretch-doorway", 4000);
    const checked = ["arm-circles", "stretch-shoulder"];
    expect((await db.rows("session_log").get(id))?.checked).toEqual(checked);
    expect((await db.outbox.toArray()).at(-1)).toMatchObject({
      entity: "session_log",
      action: "upsert",
      data: { id, endedAt: 2000, rpe: 7, checked },
    });
  });

  it("does not start, modify or revive a log for a stretch tick", async () => {
    const view = viewOf(plannedSession());
    const id = sessionLogId(view.session.id);
    await toggleStretchChecked(db, id, "stretch-doorway");
    expect(await db.rows("session_log").get(id)).toBeUndefined();
    await toggleChecked(db, view, "arm-circles", "UTC", 1000);
    await toggleStretchChecked(db, id, "stretch-doorway");
    expect(await db.rows("session_log").get(id)).toMatchObject({
      endedAt: null,
      checked: ["arm-circles"],
    });
    await finishSession(db, view, { rpe: 7, notes: null }, 2000);
    await db.rows("session_log").update(id, { deletedAt: 3000 });
    await toggleStretchChecked(db, id, "stretch-doorway");
    expect(await db.rows("session_log").get(id)).toMatchObject({
      deletedAt: 3000,
      checked: ["arm-circles"],
    });
    expect(await db.outbox.count()).toBe(2);
  });
});

describe("overlapping toggles", () => {
  const db = openLocalDb("checklist-overlap-test");
  it("keeps both ticks", async () => {
    const session = plannedSession();
    await Promise.all([
      toggleChecked(db, viewOf(session), "a", "UTC", 1000),
      toggleChecked(db, viewOf(session), "b", "UTC", 1000),
    ]);
    const log = await db.rows("session_log").get(sessionLogId(session.id));
    expect(log?.checked).toEqual(["a", "b"]);
  });
});
