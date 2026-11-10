import "fake-indexeddb/auto";
import {
  moveOverrideId,
  newId,
  type PlannedSession,
  type PlanOverride,
} from "@workout-app/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { openLocalDb } from "../sync/local-db";
import { latestMoves, moveSession, placeSession } from "./moves";

const sync = {
  userId: 1,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  serverSeq: 1,
};

const sessionId = newId();
const override = (fields: Partial<PlanOverride>): PlanOverride => ({
  id: newId(),
  ...sync,
  kind: "move",
  plannedSessionId: sessionId,
  weekId: null,
  data: { date: "2026-11-12", slot: "pm" },
  opId: newId(),
  supersededAt: null,
  ...fields,
});

const session: PlannedSession = {
  id: sessionId,
  ...sync,
  weekId: newId(),
  date: "2026-11-10",
  slot: "am",
  modality: "lift",
  workoutType: "push_a",
  templateId: null,
  intent: "support",
  status: "planned",
  generatedBy: "engine@stub-1",
};

describe("latestMoves", () => {
  it("takes each session's latest live move", () => {
    const moves = latestMoves([
      override({ updatedAt: 2, data: { date: "2026-11-13", slot: "am" } }),
      override({ updatedAt: 1 }),
    ]);
    expect(moves.get(sessionId)).toEqual({ date: "2026-11-13", slot: "am" });
    expect(placeSession(session, moves)).toMatchObject({
      date: "2026-11-13",
      slot: "am",
    });
  });

  it("ignores deleted, superseded, malformed and non-move overrides", () => {
    const moves = latestMoves([
      override({ deletedAt: 5, updatedAt: 5 }),
      override({ supersededAt: 4, updatedAt: 4 }),
      override({ data: { date: "Tuesday" }, updatedAt: 3 }),
      override({ kind: "trim", updatedAt: 2 }),
      override({ plannedSessionId: null, updatedAt: 2 }),
    ]);
    expect(moves.size).toBe(0);
    expect(placeSession(session, moves)).toBe(session);
  });
});

describe("moveSession", () => {
  const db = openLocalDb(`moves-test-${newId()}`);
  beforeEach(async () => {
    await Promise.all([db.rows("plan_override").clear(), db.outbox.clear()]);
  });
  const planned = { date: session.date, slot: session.slot };

  it("writes one move override per session, queued with its own op", async () => {
    await moveSession(
      db,
      session,
      planned,
      { date: "2026-11-12", slot: "pm" },
      10,
    );
    await moveSession(
      db,
      session,
      planned,
      { date: "2026-11-13", slot: "am" },
      20,
    );
    const rows = await db.rows("plan_override").toArray();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      id: moveOverrideId(session.id),
      kind: "move",
      plannedSessionId: session.id,
      weekId: session.weekId,
      data: { date: "2026-11-13", slot: "am" },
      createdAt: 10,
      updatedAt: 20,
      deletedAt: null,
      supersededAt: null,
    });
    const ops = await db.outbox.toArray();
    expect(ops.map((o) => o.entity)).toEqual([
      "plan_override",
      "plan_override",
    ]);
    expect(ops[1]!.opId).toBe(row!.opId);
  });

  it("deletes the override when the session goes back to its planned place", async () => {
    await moveSession(
      db,
      session,
      planned,
      { date: "2026-11-12", slot: "pm" },
      10,
    );
    await moveSession(db, session, planned, planned, 20);
    const row = await db.rows("plan_override").get(moveOverrideId(session.id));
    expect(row?.deletedAt).toBe(20);
    expect(latestMoves([row!]).size).toBe(0);
    const ops = await db.outbox.toArray();
    expect(ops.map((o) => o.action)).toEqual(["upsert", "delete"]);
  });
});
