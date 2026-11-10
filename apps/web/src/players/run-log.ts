import {
  localDateAt,
  newId,
  sessionLogId,
  type DistanceUnit,
  type RunLog,
  type RunSplit,
  type SessionLog,
  type Settings,
} from "@workout-app/shared";
import type { SessionView } from "../plan/sessions";
import type { LocalDb } from "../sync/local-db";
import { saveRow } from "../sync/writes";

export type RunSession = { log: SessionLog | null; run: RunLog | null };

/** The session's log and its run, if it's been logged. */
export async function readRunSession(
  db: LocalDb,
  sessionId: string,
): Promise<RunSession> {
  const log = await db.rows("session_log").get(sessionLogId(sessionId));
  if (!log || log.deletedAt !== null) return { log: null, run: null };
  const run = (await db.rows("run_log").toArray())
    .filter((r) => r.deletedAt === null && r.sessionLogId === log.id)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return { log, run: run ?? null };
}

/** A typed number, accepting a decimal comma; null when blank or not a number. */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Whole seconds from minutes and seconds fields; null unless it's over zero. */
export function durationOf(minutes: string, seconds: string): number | null {
  const m = parseNumber(minutes) ?? 0;
  const s = parseNumber(seconds) ?? 0;
  if (m < 0 || s < 0) return null;
  const total = Math.round(m * 60 + s);
  return total > 0 ? total : null;
}

/** Seconds per distance unit, or null without a distance and a duration. */
export function paceSec(
  distance: number | null,
  durationSec: number | null,
): number | null {
  if (!distance || distance <= 0 || !durationSec || durationSec <= 0) {
    return null;
  }
  return durationSec / distance;
}

/** "45:30" or "1:05:00". */
export function formatDuration(totalSec: number): string {
  const sec = Math.round(totalSec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "8:30 /mi". */
export const formatPace = (sec: number, unit: DistanceUnit) =>
  `${formatDuration(sec)} /${unit}`;

export const elevationUnitFor = (unit: DistanceUnit) =>
  unit === "mi" ? "ft" : "m";

export type RunEntry = {
  workoutType: string;
  distance: number;
  durationSec: number;
  avgHr: number | null;
  elevation: number | null;
  rpe: number;
  splits: RunSplit[];
  notes: string | null;
};

/**
 * Logs a finished run: the session's log, ended now and started a duration
 * earlier, and its run. Both go through the outbox, so it works offline.
 */
export async function logRun(
  db: LocalDb,
  view: SessionView,
  entry: RunEntry,
  settings: Pick<Settings, "distanceUnit" | "timezone">,
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
      modality: "run",
      startedAt: live?.startedAt ?? now - entry.durationSec * 1000,
      endedAt: now,
      localDate: live?.localDate ?? localDateAt(settings.timezone, now),
      timezone: live?.timezone ?? settings.timezone,
      rpe: entry.rpe,
      notes: entry.notes?.trim() || null,
    },
    now,
  );
  await saveRow(
    db,
    "run_log",
    {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      sessionLogId: id,
      workoutType: entry.workoutType,
      distanceValue: entry.distance,
      distanceUnit: settings.distanceUnit,
      durationSec: entry.durationSec,
      avgHr: entry.avgHr,
      elevationValue: entry.elevation,
      elevationUnit:
        entry.elevation === null
          ? null
          : elevationUnitFor(settings.distanceUnit),
      rpe: entry.rpe,
      splits: entry.splits,
    },
    now,
  );
}
