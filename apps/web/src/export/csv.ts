import type { SessionLog } from "@workout-app/shared";
import { readHistory } from "../history/history";
import type { LocalDb } from "../sync/local-db";

type Cell = string | number | boolean | null;

const cell = (value: Cell) => {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** RFC 4180 CSV with a header row and CRLF line ends. */
export function toCsv(header: readonly string[], rows: readonly Cell[][]) {
  return (
    [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"
  );
}

const live = <T extends { deletedAt: number | null }>(rows: T[]) =>
  rows.filter((r) => r.deletedAt === null);

/** Logged sessions oldest first, with their history titles. */
async function sessions(db: LocalDb) {
  const entries = (await readHistory(db)).reverse();
  return {
    order: new Map(entries.map((e, i) => [e.log.id, i])),
    byId: new Map<string, { log: SessionLog; title: string }>(
      entries.map((e) => [e.log.id, e]),
    ),
  };
}

const date = (log: SessionLog) => log.localDate;

/** One line per logged set, warm-ups included (SPEC §6.7, §8). */
export async function setsCsv(db: LocalDb): Promise<string> {
  const { order, byId } = await sessions(db);
  const exercises = new Map(
    (await db.rows("exercise").toArray()).map((e) => [e.id, e.name]),
  );
  const sets = live(await db.rows("set_log").toArray())
    .filter((s) => byId.has(s.sessionLogId))
    .sort(
      (a, b) =>
        order.get(a.sessionLogId)! - order.get(b.sessionLogId)! ||
        (a.completedAt ?? 0) - (b.completedAt ?? 0) ||
        a.index - b.index,
    );
  return toCsv(
    [
      "date",
      "session",
      "exercise",
      "set",
      "warm_up",
      "load",
      "unit",
      "band",
      "reps",
      "rir",
    ],
    sets.map((s) => {
      const { log, title } = byId.get(s.sessionLogId)!;
      return [
        date(log),
        title,
        exercises.get(s.exerciseId) ?? "Unknown exercise",
        s.index + 1,
        s.isWarmup,
        s.loadValue,
        s.loadUnit,
        s.band,
        s.reps,
        s.rir,
      ];
    }),
  );
}

/** One line per run. */
export async function runsCsv(db: LocalDb): Promise<string> {
  const { order, byId } = await sessions(db);
  const runs = live(await db.rows("run_log").toArray())
    .filter((r) => byId.has(r.sessionLogId))
    .sort((a, b) => order.get(a.sessionLogId)! - order.get(b.sessionLogId)!);
  return toCsv(
    [
      "date",
      "workout",
      "distance",
      "unit",
      "duration_sec",
      "avg_hr",
      "elevation",
      "elevation_unit",
      "rpe",
      "notes",
    ],
    runs.map((r) => {
      const { log } = byId.get(r.sessionLogId)!;
      return [
        date(log),
        r.workoutType,
        r.distanceValue,
        r.distanceUnit,
        r.durationSec,
        r.avgHr,
        r.elevationValue,
        r.elevationUnit,
        r.rpe,
        log.notes,
      ];
    }),
  );
}

/** One line per climb. */
export async function climbsCsv(db: LocalDb): Promise<string> {
  const { order, byId } = await sessions(db);
  const projects = new Map(
    (await db.rows("project").toArray()).map((p) => [p.id, p.name]),
  );
  const ascents = live(await db.rows("ascent").toArray())
    .filter((a) => byId.has(a.sessionLogId))
    .sort(
      (a, b) =>
        order.get(a.sessionLogId)! - order.get(b.sessionLogId)! ||
        a.createdAt - b.createdAt,
    );
  return toCsv(
    ["date", "session", "grade", "style", "attempts", "project", "tags"],
    ascents.map((a) => {
      const { log, title } = byId.get(a.sessionLogId)!;
      return [
        date(log),
        title,
        a.grade,
        a.style,
        a.attempts,
        a.projectId ? (projects.get(a.projectId) ?? null) : null,
        a.tags.join(" "),
      ];
    }),
  );
}
