import {
  moveOverrideDataSchema,
  moveOverrideId,
  newId,
  type MoveOverrideData,
  type PlannedSession,
  type PlanOverride,
} from "@workout-app/shared";
import type { LocalDb } from "../sync/local-db";
import { deleteRow, saveRow } from "../sync/writes";

/** Where a session sits in the week. */
export type Placement = Pick<PlannedSession, "date" | "slot">;

export const samePlacement = (a: Placement, b: Placement) =>
  a.date === b.date && a.slot === b.slot;

/**
 * The owner's moves by planned session id (SPEC §5.4): each session's latest
 * live `move` override. Superseded, deleted and malformed ones are ignored.
 */
export function latestMoves(
  overrides: readonly PlanOverride[],
): Map<string, MoveOverrideData> {
  const latest = new Map<string, PlanOverride>();
  for (const o of overrides) {
    if (
      o.kind !== "move" ||
      o.plannedSessionId === null ||
      o.deletedAt !== null ||
      o.supersededAt !== null ||
      !moveOverrideDataSchema.safeParse(o.data).success
    )
      continue;
    const current = latest.get(o.plannedSessionId);
    if (!current || o.updatedAt > current.updatedAt) {
      latest.set(o.plannedSessionId, o);
    }
  }
  return new Map(
    [...latest].map(([id, o]) => [id, moveOverrideDataSchema.parse(o.data)]),
  );
}

/** A session where the owner put it, if it was moved, else where it was planned. */
export function placeSession(
  session: PlannedSession,
  moves: ReadonlyMap<string, MoveOverrideData>,
): PlannedSession {
  const move = moves.get(session.id);
  return move ? { ...session, date: move.date, slot: move.slot } : session;
}

/**
 * Moves a planned session by hand. Plan rows are server-owned (SPEC §3.1), so
 * this writes the session's `move` override, which syncs like any row; moving
 * it back to where it was planned deletes the override.
 */
export async function moveSession(
  db: LocalDb,
  session: Pick<PlannedSession, "id" | "weekId">,
  planned: Placement,
  to: Placement,
  now = Date.now(),
): Promise<void> {
  const id = moveOverrideId(session.id);
  if (samePlacement(planned, to)) {
    await deleteRow(db, "plan_override", id, now);
    return;
  }
  const existing = await db.rows("plan_override").get(id);
  const opId = newId();
  const data: MoveOverrideData = { date: to.date, slot: to.slot };
  await saveRow(
    db,
    "plan_override",
    {
      id,
      createdAt:
        existing && existing.deletedAt === null ? existing.createdAt : now,
      updatedAt: now,
      deletedAt: null,
      kind: "move",
      plannedSessionId: session.id,
      weekId: session.weekId,
      data,
      opId,
      supersededAt: null,
    },
    now,
    opId,
  );
}
