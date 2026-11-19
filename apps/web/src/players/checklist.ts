import {
  localDateAt,
  sessionLogId,
  type Checklist,
  type ChecklistKind,
  type ChecklistSessionType,
  type PlannedSession,
} from "@workout-app/shared";
import type { SessionView } from "../plan/sessions";
import type { LocalDb } from "../sync/local-db";
import { saveRow } from "../sync/writes";

/** The checklist type of a session: runs and climbs by modality, lifts by family (`push_a` is push). */
export function checklistSessionType(
  session: Pick<PlannedSession, "modality" | "workoutType">,
): ChecklistSessionType | null {
  if (session.modality === "run") return "run";
  if (session.modality === "climb") return "climb";
  if (session.modality !== "lift") return null;
  const family = session.workoutType.split("_")[0];
  return family === "push" || family === "pull" || family === "legs"
    ? family
    : null;
}

/** The session's live checklist of this kind, or `null` if it has none. */
export async function readChecklist(
  db: LocalDb,
  session: Pick<PlannedSession, "modality" | "workoutType">,
  kind: ChecklistKind,
): Promise<Checklist | null> {
  const type = checklistSessionType(session);
  if (!type) return null;
  const lists = await db.rows("checklist").toArray();
  return (
    lists
      .filter(
        (c) =>
          c.deletedAt === null && c.kind === kind && c.sessionType === type,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
  );
}

function toggleItem(checked: readonly string[], itemId: string): string[] {
  return checked.includes(itemId)
    ? checked.filter((id) => id !== itemId)
    : [...checked, itemId];
}

/** Updates an already finished session without starting or reviving a log. */
export async function toggleStretchChecked(
  db: LocalDb,
  logId: string,
  itemId: string,
  now = Date.now(),
): Promise<void> {
  const logs = db.rows("session_log");
  await db.transaction("rw", logs, db.outbox, async () => {
    const log = await logs.get(logId);
    if (!log || log.deletedAt !== null || log.endedAt === null) return;
    await saveRow(
      db,
      "session_log",
      { ...log, checked: toggleItem(log.checked, itemId), updatedAt: now },
      now,
    );
  });
}

async function applyToggle(
  db: LocalDb,
  view: SessionView,
  itemId: string,
  timezone: string,
  now = Date.now(),
): Promise<void> {
  const id = sessionLogId(view.session.id);
  const existing = await db.rows("session_log").get(id);
  const live = existing && existing.deletedAt === null ? existing : null;
  await saveRow(
    db,
    "session_log",
    {
      id,
      createdAt: live?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
      plannedSessionId: view.session.id,
      modality: live?.modality ?? view.session.modality,
      startedAt: live?.startedAt ?? now,
      endedAt: live?.endedAt ?? null,
      localDate: live?.localDate ?? localDateAt(timezone, now),
      timezone: live?.timezone ?? timezone,
      rpe: live?.rpe ?? null,
      notes: live?.notes ?? null,
      checked: toggleItem(live?.checked ?? [], itemId),
    },
    now,
  );
}

let queue: Promise<void> = Promise.resolve();

/**
 * Ticks or unticks a checklist item on the session's log, starting the log
 * if this is the first thing done in the session, like a first set. Toggles
 * run one at a time, so quick taps don't overwrite each other.
 */
export function toggleChecked(
  db: LocalDb,
  view: SessionView,
  itemId: string,
  timezone: string,
  now = Date.now(),
): Promise<void> {
  const run = queue.then(() => applyToggle(db, view, itemId, timezone, now));
  queue = run.catch(() => {});
  return run;
}
