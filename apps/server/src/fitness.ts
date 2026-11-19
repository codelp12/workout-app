import {
  e1rmSeries,
  ENGINE_CONFIG,
  groupLogs,
  LIFT_ENGINE_VERSION,
} from "@workout-app/engine";
import { fitnessStateId, localDateAt } from "@workout-app/shared";
import { eq } from "drizzle-orm";
import { ownerSettings } from "./plan.js";
import { fitnessState, sessionLog, setLog } from "./schema.js";
import { nextSeq, OWNER_USER_ID, type Tx } from "./sync.js";

/**
 * Rewrites the lift e1RM series in `fitness_state` (SPEC §4, §5.1) from the
 * onboarding answers and every lift log. Only rows whose values changed get
 * written, and points no longer in the series are tombstoned, so an unchanged
 * history syncs nothing. Returns how many rows it wrote.
 */
export function refreshFitnessState(tx: Tx, now: number): number {
  const owner = ownerSettings(tx, now);
  const onboardingDate = owner.onboarding
    ? localDateAt(owner.timezone, owner.onboarding.completedAt)
    : null;
  const { lift } = groupLogs({
    sessions: tx.select().from(sessionLog).all(),
    sets: tx.select().from(setLog).all(),
    runs: [],
    ascents: [],
  });
  const points = e1rmSeries(
    owner.onboarding,
    onboardingDate,
    lift,
    ENGINE_CONFIG.lift,
  );
  const existing = new Map(
    tx
      .select()
      .from(fitnessState)
      .where(eq(fitnessState.metric, "e1rm"))
      .all()
      .map((row) => [row.id, row]),
  );

  let written = 0;
  const kept = new Set<string>();
  for (const point of points) {
    const id = fitnessStateId("e1rm", point.exerciseId, point.date);
    kept.add(id);
    const values = {
      metric: "e1rm" as const,
      exerciseId: point.exerciseId,
      date: point.date,
      value: point.e1rm.value,
      unit: point.e1rm.unit,
      confidence: point.confidence,
      engineVersion: LIFT_ENGINE_VERSION,
      deletedAt: null,
    };
    const row = existing.get(id);
    if (
      row &&
      (Object.keys(values) as (keyof typeof values)[]).every(
        (key) => row[key] === values[key],
      )
    ) {
      continue;
    }
    const update = { ...values, updatedAt: now, serverSeq: nextSeq(tx) };
    tx.insert(fitnessState)
      .values({ ...update, id, userId: OWNER_USER_ID, createdAt: now })
      .onConflictDoUpdate({ target: fitnessState.id, set: update })
      .run();
    written++;
  }
  for (const row of existing.values()) {
    if (kept.has(row.id) || row.deletedAt !== null) continue;
    tx.update(fitnessState)
      .set({ deletedAt: now, updatedAt: now, serverSeq: nextSeq(tx) })
      .where(eq(fitnessState.id, row.id))
      .run();
    written++;
  }
  return written;
}
