import {
  newId,
  skipOverrideId,
  swapOverrideDataSchema,
  swapOverrideId,
  trimOverrideDataSchema,
  type OverrideKind,
  type PlannedItem,
  type PlannedSession,
  type PlanOverride,
} from "@workout-app/shared";
import type { LocalDb } from "../sync/local-db";
import { deleteRow, saveRow } from "../sync/writes";

/** The owner's swaps and skips of planned items. */
export type ItemOverrides = {
  /** Planned item id → the exercise done in its place. */
  swaps: Map<string, string>;
  /** Planned item ids the owner skipped. */
  skips: Set<string>;
};

const isLive = (o: PlanOverride) =>
  o.deletedAt === null && o.supersededAt === null;

/** The live `swap` and `trim` overrides, keyed by planned item. */
export function itemOverrides(
  overrides: readonly PlanOverride[],
): ItemOverrides {
  const swaps = new Map<string, PlanOverride>();
  const skips = new Set<string>();
  for (const o of overrides) {
    if (!isLive(o)) continue;
    if (o.kind === "swap") {
      const data = swapOverrideDataSchema.safeParse(o.data);
      if (!data.success) continue;
      const current = swaps.get(data.data.itemId);
      if (!current || o.updatedAt > current.updatedAt) {
        swaps.set(data.data.itemId, o);
      }
    } else if (o.kind === "trim") {
      const data = trimOverrideDataSchema.safeParse(o.data);
      if (data.success) skips.add(data.data.itemId);
    }
  }
  return {
    swaps: new Map(
      [...swaps].map(([id, o]) => [
        id,
        swapOverrideDataSchema.parse(o.data).exerciseId,
      ]),
    ),
    skips,
  };
}

type Item = Pick<PlannedItem, "id" | "plannedSessionId" | "exerciseId">;

async function saveItemOverride(
  db: LocalDb,
  id: string,
  kind: OverrideKind,
  item: Item,
  session: Pick<PlannedSession, "weekId">,
  data: Record<string, unknown>,
  now: number,
): Promise<void> {
  const existing = await db.rows("plan_override").get(id);
  const opId = newId();
  await saveRow(
    db,
    "plan_override",
    {
      id,
      createdAt:
        existing && existing.deletedAt === null ? existing.createdAt : now,
      updatedAt: now,
      deletedAt: null,
      kind,
      plannedSessionId: item.plannedSessionId,
      weekId: session.weekId,
      data,
      opId,
      supersededAt: null,
    },
    now,
    opId,
  );
}

/**
 * Does `exerciseId` in place of the item's planned exercise. Swapping back to
 * the planned one deletes the override. One row per item, so the latest swap
 * wins on every device.
 */
export async function swapExercise(
  db: LocalDb,
  item: Item,
  session: Pick<PlannedSession, "weekId">,
  exerciseId: string,
  now = Date.now(),
): Promise<void> {
  const id = swapOverrideId(item.id);
  if (exerciseId === item.exerciseId) {
    await deleteRow(db, "plan_override", id, now);
    return;
  }
  await saveItemOverride(
    db,
    id,
    "swap",
    item,
    session,
    { itemId: item.id, exerciseId },
    now,
  );
}

/** Skips the item, or undoes the skip, as a `trim` override. */
export async function skipItem(
  db: LocalDb,
  item: Item,
  session: Pick<PlannedSession, "weekId">,
  skipped: boolean,
  now = Date.now(),
): Promise<void> {
  const id = skipOverrideId(item.id);
  if (!skipped) {
    await deleteRow(db, "plan_override", id, now);
    return;
  }
  await saveItemOverride(
    db,
    id,
    "trim",
    item,
    session,
    { itemId: item.id },
    now,
  );
}
