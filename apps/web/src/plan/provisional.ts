import { groupLogs, planWeek, type LiftExercise } from "@workout-app/engine";
import {
  defaultSettings,
  localDateAt,
  SETTINGS_ID,
  weekId,
  weekStartOf,
} from "@workout-app/shared";
import type { LocalDb } from "../sync/local-db";
import { OWNER_USER_ID } from "../sync/writes";

const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const PLAN_TABLES = [
  "block",
  "week",
  "planned_session",
  "planned_item",
] as const;

/**
 * Plans this week on the device if it has no row for it yet, so the phone
 * runs a provisional week until the server's arrives (SPEC §3.2). The rows
 * have `serverSeq` 0 and never enter the outbox; the server's version has
 * the same ids, so a pull replaces them. Returns whether it planned a week.
 */
export function planProvisionalWeek(
  db: LocalDb,
  now = Date.now(),
): Promise<boolean> {
  const tables = [
    ...PLAN_TABLES,
    "settings",
    "template",
    "exercise",
    "session_log",
    "set_log",
    "run_log",
    "ascent",
  ] as const;
  return db.transaction(
    "rw",
    tables.map((name) => db.rows(name)),
    async () => {
      const saved = await db.rows("settings").get(SETTINGS_ID);
      const settings =
        saved && saved.deletedAt === null
          ? saved
          : defaultSettings(deviceTimezone(), now);
      const weekStart = weekStartOf(localDateAt(settings.timezone, now));
      if (await db.rows("week").get(weekId(weekStart))) return false;

      const exercises: LiftExercise[] = (
        await db.rows("exercise").toArray()
      ).filter((e) => e.deletedAt === null && e.modality === "lift");
      const plan = planWeek({
        weekStart,
        now,
        blocks: await db.rows("block").toArray(),
        settings,
        templates: await db.rows("template").toArray(),
        exercises,
        logs: groupLogs({
          sessions: await db.rows("session_log").toArray(),
          sets: await db.rows("set_log").toArray(),
          runs: await db.rows("run_log").toArray(),
          ascents: await db.rows("ascent").toArray(),
        }),
      });
      const local = <T>(row: T) => ({
        ...row,
        userId: OWNER_USER_ID,
        serverSeq: 0,
      });
      if (plan.block) await db.rows("block").put(local(plan.block));
      await db.rows("week").put(local(plan.week));
      await db.rows("planned_session").bulkPut(plan.sessions.map(local));
      await db.rows("planned_item").bulkPut(plan.items.map(local));
      return true;
    },
  );
}

/**
 * After a pull, drops provisional plan rows the server's week didn't replace
 * by id: sessions and items of weeks the server has sent, and blocks no week
 * uses any more. Rows with a queued write are kept.
 */
export function dropReplacedProvisional(db: LocalDb): Promise<void> {
  return db.transaction(
    "rw",
    [...PLAN_TABLES.map((name) => db.rows(name)), db.outbox],
    async () => {
      const pending = new Set((await db.outbox.toArray()).map((o) => o.rowId));
      const provisional = (row: { id: string; serverSeq: number }) =>
        row.serverSeq === 0 && !pending.has(row.id);

      const weeks = await db.rows("week").toArray();
      const synced = new Set(
        weeks.filter((w) => w.serverSeq > 0).map((w) => w.id),
      );
      const inSynced = (weekId: string | null) =>
        weekId !== null && synced.has(weekId);

      const sessions = await db.rows("planned_session").toArray();
      const staleSessions = sessions.filter(
        (s) => provisional(s) && inSynced(s.weekId),
      );
      const syncedSessions = new Set(
        sessions.filter((s) => inSynced(s.weekId)).map((s) => s.id),
      );
      const staleItems = (await db.rows("planned_item").toArray()).filter(
        (i) => provisional(i) && syncedSessions.has(i.plannedSessionId),
      );
      const usedBlocks = new Set(weeks.map((w) => w.blockId));
      const staleBlocks = (await db.rows("block").toArray()).filter(
        (b) => provisional(b) && !usedBlocks.has(b.id),
      );

      await db
        .rows("planned_session")
        .bulkDelete(staleSessions.map((s) => s.id));
      await db.rows("planned_item").bulkDelete(staleItems.map((i) => i.id));
      await db.rows("block").bulkDelete(staleBlocks.map((b) => b.id));
    },
  );
}
