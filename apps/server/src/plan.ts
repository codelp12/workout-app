import { groupLogs, planWeek, type LiftExercise } from "@workout-app/engine";
import {
  defaultSettings,
  localDateAt,
  SETTINGS_ID,
  weekId,
  weekStartOf,
  isTemplateModality,
} from "@workout-app/shared";
import { eq } from "drizzle-orm";
import type { Db } from "./db.js";
import {
  ascent,
  block,
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
    tx.insert(block)
      .values({ ...owned(plan.block), serverSeq: nextSeq(tx) })
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
    const saved = tx
      .select()
      .from(settings)
      .where(eq(settings.id, SETTINGS_ID))
      .get();
    const owner =
      saved && saved.deletedAt === null
        ? saved
        : defaultSettings(serverTimezone(), now);
    const weekStart = weekStartOf(localDateAt(owner.timezone, now));
    const existing = tx
      .select({ id: week.id })
      .from(week)
      .where(eq(week.id, weekId(weekStart)))
      .get();
    if (existing) return false;

    const exercises: LiftExercise[] = tx
      .select()
      .from(exercise)
      .all()
      .filter((e) => e.deletedAt === null && isTemplateModality(e.modality));
    insertPlan(
      tx,
      planWeek({
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
        }),
      }),
    );
    return true;
  });
}
