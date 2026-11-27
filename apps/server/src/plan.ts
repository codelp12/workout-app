import {
  groupLogs,
  planWeek,
  type EngineDecision,
  type PlanExercise,
  type WeekPlanInput,
} from "@workout-app/engine";
import {
  defaultSettings,
  localDateAt,
  SETTINGS_ID,
  weekId,
  weekStartOf,
  isTemplateModality,
} from "@workout-app/shared";
import { eq, inArray } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import type { Db } from "./db.js";
import {
  ascent,
  block,
  engineDecision,
  exercise,
  plannedItem,
  plannedSession,
  runLog,
  sessionLog,
  setLog,
  settings,
  template,
  week,
} from "./schema.js";
import { nextSeq, OWNER_USER_ID, type Tx } from "./sync.js";

/** The server's own zone, used until the owner's settings first sync. */
const serverTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const owned = <T>(row: T) => ({ ...row, userId: OWNER_USER_ID });

function insertPlan(tx: Tx, plan: ReturnType<typeof planWeek>) {
  if (plan.block) {
    // An early deload rewrites the current block's length.
    const row = { ...owned(plan.block), serverSeq: nextSeq(tx) };
    tx.insert(block)
      .values(row)
      .onConflictDoUpdate({ target: block.id, set: row })
      .run();
  }
  tx.insert(week)
    .values({ ...owned(plan.week), serverSeq: nextSeq(tx) })
    .run();
  for (const s of plan.sessions) {
    tx.insert(plannedSession)
      .values({ ...owned(s), serverSeq: nextSeq(tx) })
      .run();
  }
  for (const item of plan.items) {
    tx.insert(plannedItem)
      .values({ ...owned(item), serverSeq: nextSeq(tx) })
      .run();
  }
  for (const decision of plan.decisions) {
    upsertDecision(tx, decision, plan.week.createdAt);
  }
}

function upsertDecision(tx: Tx, decision: EngineDecision, now: number) {
  const row = {
    id: decision.plannedItemId,
    createdAt: now,
    engineVersion: decision.engineVersion,
    inputs: decision.inputs,
    rules: decision.rules,
    outputs: decision.outputs,
  };
  tx.insert(engineDecision)
    .values(row)
    .onConflictDoUpdate({
      target: engineDecision.id,
      set: {
        createdAt: row.createdAt,
        engineVersion: row.engineVersion,
        inputs: row.inputs,
        rules: row.rules,
        outputs: row.outputs,
      },
    })
    .run();
}

/** The owner's settings, or the defaults until they first sync. */
export function ownerSettings(tx: Tx, now: number) {
  const saved = tx
    .select()
    .from(settings)
    .where(eq(settings.id, SETTINGS_ID))
    .get();
  return saved && saved.deletedAt === null
    ? saved
    : defaultSettings(serverTimezone(), now);
}

function planInput(
  tx: Tx,
  owner: ReturnType<typeof ownerSettings>,
  weekStart: string,
  now: number,
): WeekPlanInput {
  const exercises: PlanExercise[] = tx
    .select()
    .from(exercise)
    .all()
    .filter((e) => e.deletedAt === null && isTemplateModality(e.modality));
  return {
    weekStart,
    now,
    blocks: tx.select().from(block).all(),
    settings: owner,
    templates: tx.select().from(template).all(),
    exercises,
    logs: groupLogs({
      sessions: tx.select().from(sessionLog).all(),
      sets: tx.select().from(setLog).all(),
      runs: tx.select().from(runLog).all(),
      ascents: tx.select().from(ascent).all(),
      items: tx.select().from(plannedItem).all(),
    }),
  };
}

/**
 * Weekly rollover (SPEC §3.2): if the week that's current in the owner's zone
 * has no row yet, plans it from every log on the server. Runs at the start of
 * each pull, so the first sync after Sunday midnight generates the new week.
 * Week ids come from their start date, so it never makes a second copy.
 * Returns whether it planned a week.
 */
export function planCurrentWeek(db: Db, now: number): boolean {
  return db.transaction((tx) => {
    const owner = ownerSettings(tx, now);
    const weekStart = weekStartOf(localDateAt(owner.timezone, now));
    const existing = tx
      .select({ id: week.id })
      .from(week)
      .where(eq(week.id, weekId(weekStart)))
      .get();
    if (existing) return false;

    insertPlan(tx, planWeek(planInput(tx, owner, weekStart, now)));
    return true;
  });
}

/**
 * Replans only this week's upcoming, unstarted lift sessions after training
 * inputs change. The calendar, sessions and client overrides remain untouched.
 */
export function replanLifts(tx: Tx, now: number): number {
  const owner = ownerSettings(tx, now);
  const today = localDateAt(owner.timezone, now);
  const weekStart = weekStartOf(today);
  const existingWeek = tx
    .select()
    .from(week)
    .where(eq(week.id, weekId(weekStart)))
    .get();
  if (!existingWeek) return 0;

  const plan = planWeek(planInput(tx, owner, weekStart, now));
  if (
    plan.week.blockId !== existingWeek.blockId ||
    plan.week.index !== existingWeek.index ||
    plan.week.type !== existingWeek.type
  ) {
    return 0;
  }

  const liveLogs = new Set(
    tx
      .select()
      .from(sessionLog)
      .all()
      .filter((log) => log.deletedAt === null && log.plannedSessionId !== null)
      .map((log) => log.plannedSessionId!),
  );
  const sessions = tx
    .select()
    .from(plannedSession)
    .where(eq(plannedSession.weekId, existingWeek.id))
    .all()
    .filter(
      (session) =>
        session.deletedAt === null &&
        session.modality === "lift" &&
        session.status === "planned" &&
        session.date >= today &&
        !liveLogs.has(session.id),
    );
  if (sessions.length === 0) return 0;

  const sessionIds = sessions.map((session) => session.id);
  const currentItems = tx
    .select()
    .from(plannedItem)
    .where(inArray(plannedItem.plannedSessionId, sessionIds))
    .all();
  const itemsBySession = new Map<string, typeof currentItems>();
  for (const item of currentItems) {
    itemsBySession.set(item.plannedSessionId, [
      ...(itemsBySession.get(item.plannedSessionId) ?? []),
      item,
    ]);
  }
  const plannedBySession = new Map<string, typeof plan.items>();
  for (const item of plan.items) {
    if (!sessionIds.includes(item.plannedSessionId)) continue;
    plannedBySession.set(item.plannedSessionId, [
      ...(plannedBySession.get(item.plannedSessionId) ?? []),
      item,
    ]);
  }
  const decisionsByItem = new Map<string, EngineDecision>();
  for (const decision of plan.decisions) {
    decisionsByItem.set(decision.plannedItemId, decision);
  }

  let written = 0;
  for (const session of sessions) {
    const plannedItems = plannedBySession.get(session.id) ?? [];
    const plannedIds = new Set(plannedItems.map((item) => item.id));
    const existingItems = itemsBySession.get(session.id) ?? [];
    const existingById = new Map<string, (typeof currentItems)[number]>();
    for (const item of existingItems) existingById.set(item.id, item);
    for (const item of plannedItems) {
      const existing = existingById.get(item.id);
      if (!existing) {
        tx.insert(plannedItem)
          .values({ ...owned(item), serverSeq: nextSeq(tx) })
          .run();
        written++;
      } else if (
        existing.deletedAt !== null ||
        existing.kind !== item.kind ||
        existing.position !== item.position ||
        existing.exerciseId !== item.exerciseId ||
        !isDeepStrictEqual(existing.targets, item.targets) ||
        !isDeepStrictEqual(existing.reasons, item.reasons)
      ) {
        tx.update(plannedItem)
          .set({
            position: item.position,
            kind: item.kind,
            exerciseId: item.exerciseId,
            targets: item.targets,
            reasons: item.reasons,
            updatedAt: now,
            deletedAt: null,
            serverSeq: nextSeq(tx),
          })
          .where(eq(plannedItem.id, item.id))
          .run();
        written++;
      }
      const decision = decisionsByItem.get(item.id);
      if (decision) upsertDecision(tx, decision, now);
    }
    for (const item of existingItems) {
      if (item.deletedAt !== null || plannedIds.has(item.id)) continue;
      tx.update(plannedItem)
        .set({ deletedAt: now, updatedAt: now, serverSeq: nextSeq(tx) })
        .where(eq(plannedItem.id, item.id))
        .run();
      written++;
    }
  }
  return written;
}
