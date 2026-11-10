import "fake-indexeddb/auto";
import {
  newId,
  skipOverrideId,
  swapOverrideId,
  type PlanOverride,
} from "@workout-app/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { openLocalDb } from "../sync/local-db";
import { itemOverrides, skipItem, swapExercise } from "./item-overrides";

const sync = {
  userId: 1,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  serverSeq: 1,
};

const item = { id: newId(), plannedSessionId: newId(), exerciseId: newId() };
const session = { weekId: newId() };
const dumbbell = newId();

const override = (fields: Partial<PlanOverride>): PlanOverride => ({
  id: newId(),
  ...sync,
  kind: "swap",
  plannedSessionId: item.plannedSessionId,
  weekId: null,
  data: { itemId: item.id, exerciseId: dumbbell },
  opId: newId(),
  supersededAt: null,
  ...fields,
});

describe("itemOverrides", () => {
  it("takes each item's latest live swap and its skip", () => {
    const other = newId();
    const { swaps, skips } = itemOverrides([
      override({ updatedAt: 2, data: { itemId: item.id, exerciseId: other } }),
      override({ updatedAt: 1 }),
      override({ kind: "trim", data: { itemId: item.id } }),
    ]);
    expect(swaps.get(item.id)).toBe(other);
    expect(skips.has(item.id)).toBe(true);
  });

  it("ignores deleted, superseded, malformed and other overrides", () => {
    const { swaps, skips } = itemOverrides([
      override({ deletedAt: 5 }),
      override({ supersededAt: 4 }),
      override({ data: { itemId: item.id } }),
      override({ kind: "trim", deletedAt: 3, data: { itemId: item.id } }),
      override({ kind: "trim", data: {} }),
      override({ kind: "move", data: { date: "2026-11-12", slot: "pm" } }),
    ]);
    expect(swaps.size).toBe(0);
    expect(skips.size).toBe(0);
  });
});

describe("swapExercise and skipItem", () => {
  const db = openLocalDb(`item-overrides-test-${newId()}`);
  beforeEach(async () => {
    await Promise.all([db.rows("plan_override").clear(), db.outbox.clear()]);
  });

  it("writes one swap per item, queued for sync with its own op", async () => {
    await swapExercise(db, item, session, newId(), 10);
    await swapExercise(db, item, session, dumbbell, 20);
    const rows = await db.rows("plan_override").toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: swapOverrideId(item.id),
      kind: "swap",
      plannedSessionId: item.plannedSessionId,
      weekId: session.weekId,
      data: { itemId: item.id, exerciseId: dumbbell },
      createdAt: 10,
      updatedAt: 20,
    });
    const ops = await db.outbox.toArray();
    expect(ops.map((o) => [o.entity, o.action])).toEqual([
      ["plan_override", "upsert"],
      ["plan_override", "upsert"],
    ]);
    expect(ops[1]!.opId).toBe(rows[0]!.opId);
  });

  it("deletes the swap when the planned exercise is picked again", async () => {
    await swapExercise(db, item, session, dumbbell, 10);
    await swapExercise(db, item, session, item.exerciseId, 20);
    const row = await db.rows("plan_override").get(swapOverrideId(item.id));
    expect(row?.deletedAt).toBe(20);
    expect(itemOverrides([row!]).swaps.size).toBe(0);
  });

  it("skips as a trim override and undoes it with a delete", async () => {
    await skipItem(db, item, session, true, 10);
    const row = await db.rows("plan_override").get(skipOverrideId(item.id));
    expect(row).toMatchObject({ kind: "trim", data: { itemId: item.id } });
    expect(itemOverrides([row!]).skips.has(item.id)).toBe(true);
    await skipItem(db, item, session, false, 20);
    const undone = await db.rows("plan_override").get(skipOverrideId(item.id));
    expect(itemOverrides([undone!]).skips.size).toBe(0);
    const ops = await db.outbox.toArray();
    expect(ops.map((o) => o.action)).toEqual(["upsert", "delete"]);
  });
});
