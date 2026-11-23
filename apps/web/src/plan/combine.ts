import {
  combineOverrideId,
  liftCombinations,
  newId,
  sessionLogId,
} from "@workout-app/shared";
import type { LocalDb } from "../sync/local-db";
import { saveRow } from "../sync/writes";
import { latestMoves, placeSession, samePlacement } from "./moves";

/** Creates the shared plan only if both lifts are still eligible. */
export async function combineLifts(
  db: LocalDb,
  primaryId: string,
  otherId: string,
  now = Date.now(),
): Promise<boolean> {
  const plans = db.rows("planned_session");
  const logs = db.rows("session_log");
  const overrides = db.rows("plan_override");
  return db.transaction("rw", plans, logs, overrides, db.outbox, async () => {
    const rows = await plans.toArray();
    const current = await logs.toArray();
    const changes = await overrides.toArray();
    const pairs = liftCombinations(changes, rows, current);
    const paired = new Set([...pairs.keys(), ...pairs.values()]);
    const started = new Set(
      current.filter((l) => l.deletedAt === null).map((l) => l.id),
    );
    const available = rows.filter(
      (p) =>
        p.deletedAt === null &&
        p.modality === "lift" &&
        p.status === "planned" &&
        !paired.has(p.id) &&
        !started.has(sessionLogId(p.id)),
    );
    const primary = available.find((p) => p.id === primaryId);
    if (!primary || primaryId === otherId) return false;
    const moves = latestMoves(changes);
    const placement = placeSession(primary, moves);
    const others = available.filter(
      (p) => p !== primary && samePlacement(placement, placeSession(p, moves)),
    );
    if (others.length !== 1 || others[0]?.id !== otherId) return false;

    const id = combineOverrideId(primaryId);
    const previous = await overrides.get(id);
    const opId = newId();
    await saveRow(
      db,
      "plan_override",
      {
        id,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
        kind: "combine",
        plannedSessionId: primaryId,
        weekId: primary.weekId,
        data: { otherSessionId: otherId },
        opId,
        supersededAt: null,
      },
      now,
      opId,
    );
    return true;
  });
}
