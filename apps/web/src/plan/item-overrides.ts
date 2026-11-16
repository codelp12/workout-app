import {
  addOverrideDataSchema,
  newId,
  skipOverrideId,
  swapOverrideDataSchema,
  swapOverrideId,
  trimOverrideDataSchema,
  type Exercise,
  type OverrideKind,
  type PlannedItem,
  type PlannedSession,
  type PlanOverride,
} from "@workout-app/shared";
import type { LocalDb } from "../sync/local-db";
import type { LiftTargets } from "./sessions";
import { deleteRow, saveRow } from "../sync/writes";

/** An exercise the owner added to a session, shaped like a planned item. */
export type AddedItem = Pick<
  PlannedItem,
  "id" | "plannedSessionId" | "exerciseId" | "targets"
>;

/** The owner's swaps, skips and added exercises. */
export type ItemOverrides = {
  /** Planned item id → the exercise done in its place. */
  swaps: Map<string, string>;
  /** Planned item ids the owner skipped. */
  skips: Set<string>;
  /** Added exercises, oldest first. */
  added: AddedItem[];
};

const isLive = (o: PlanOverride) =>
  o.deletedAt === null && o.supersededAt === null;

/** The live `swap` and `trim` overrides, keyed by planned item. */
export function itemOverrides(
  overrides: readonly PlanOverride[],
): ItemOverrides {
  const swaps = new Map<string, PlanOverride>();
  const skips = new Set<string>();
  const added: (AddedItem & { createdAt: number })[] = [];
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
    } else if (o.kind === "add" && o.plannedSessionId !== null) {
      const data = addOverrideDataSchema.safeParse(o.data);
      if (!data.success) continue;
      added.push({
        id: data.data.itemId,
        plannedSessionId: o.plannedSessionId,
        exerciseId: data.data.exerciseId,
        targets: data.data.targets,
        createdAt: o.createdAt,
      });
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
    added: added
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(({ id, plannedSessionId, exerciseId, targets }) => ({
        id,
        plannedSessionId,
        exerciseId,
        targets,
      })),
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

/** What an added exercise asks for: the template editor's defaults for a new slot. */
export function addedTargets(
  exercise: Pick<Exercise, "repMin" | "repMax">,
): LiftTargets {
  return {
    sets: 3,
    load: null,
    band: null,
    repMin: exercise.repMin ?? 8,
    repMax: exercise.repMax ?? 12,
    targetRir: 2,
    restSec: 90,
    ramp: false,
  };
}

/**
 * Adds an exercise to the end of a session as an `add` override. Returns the
 * new item's id. Skipping it works like skipping a planned item.
 */
export async function addExercise(
  db: LocalDb,
  session: Pick<PlannedSession, "id" | "weekId">,
  exercise: Pick<Exercise, "id" | "repMin" | "repMax">,
  now = Date.now(),
): Promise<string> {
  const itemId = newId();
  await saveItemOverride(
    db,
    newId(),
    "add",
    { id: itemId, plannedSessionId: session.id, exerciseId: exercise.id },
    session,
    { itemId, exerciseId: exercise.id, targets: addedTargets(exercise) },
    now,
  );
  return itemId;
}
