import { toDistanceUnit, toWeightUnit } from "@workout-app/engine";
import {
  addDays,
  CLIMB_DISCIPLINES,
  weekId,
  weekStartOf,
  type Ascent,
  type DistanceUnit,
  type PlannedItem,
  type PlannedSession,
  type SessionLog,
  type SetLog,
  type WeekType,
  type WeightUnit,
} from "@workout-app/shared";
import { hardestSend, isSend } from "../players/climb-log";
import { isBodyweight } from "../players/lift-log";
import type { LiftTargets, RunTargets } from "../plan/sessions";
import type { LocalDb } from "../sync/local-db";
import { latestRun } from "./history";

/** Weeks in a block when there's no block row to go by. */
const FALLBACK_WEEKS = 4;

export type GridWeek = {
  /** The Monday it starts on. */
  start: string;
  /** 1-based position in its block. */
  number: number;
  type: WeekType | null;
};

/** The weeks the grid shows, plus the neighbouring blocks to page to. */
export type GridSpan = {
  weeks: GridWeek[];
  earlier: string | null;
  later: string | null;
};

export type LiftCell = { target: LiftTargets | null; top: SetLog | null };
export type LiftRow = {
  exerciseId: string;
  name: string;
  /** Whether weight logged on it is added to bodyweight. */
  bodyweight: boolean;
  cells: LiftCell[];
};

export type RunWeek = {
  runs: number;
  planned: number;
  /** Totals in the settings' distance unit. */
  distance: number;
  plannedDistance: number;
  longest: number;
  durationSec: number;
};

export type ClimbWeek = {
  sessions: number;
  planned: number;
  sends: number;
  attempts: number;
  /** Hardest send on each grade scale, boulders first. Sends and attempts include unfinished sessions; `sessions` counts finished ones. */
  hardest: string[];
};

export type LogGrid = {
  lift: LiftRow[];
  run: RunWeek[];
  climb: ClimbWeek[];
};

export type GridUnits = { weightUnit: WeightUnit; distanceUnit: DistanceUnit };

const live = <T extends { deletedAt: number | null }>(rows: T[]) =>
  rows.filter((r) => r.deletedAt === null);

/**
 * The block to show: the one starting on `blockStart` if given, else the one
 * `today` falls in, else the latest one started. With no blocks, the four
 * weeks up to this one.
 */
export async function gridSpan(
  db: LocalDb,
  today: string,
  blockStart: string | null,
): Promise<GridSpan> {
  const blocks = live(await db.rows("block").toArray()).sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );
  const endOf = (b: (typeof blocks)[number]) =>
    addDays(b.startDate, b.weekCount * 7 - 1);
  const started = blocks.filter((b) => b.startDate <= today);
  const index = blocks.indexOf(
    blocks.find((b) => b.startDate === blockStart) ??
      blocks.find((b) => b.startDate <= today && today <= endOf(b)) ??
      started[started.length - 1] ??
      blocks[0]!,
  );
  const block = blocks[index];
  if (!block) {
    const start = addDays(weekStartOf(today), -7 * (FALLBACK_WEEKS - 1));
    return {
      weeks: Array.from({ length: FALLBACK_WEEKS }, (_, i) => ({
        start: addDays(start, i * 7),
        number: i + 1,
        type: null,
      })),
      earlier: null,
      later: null,
    };
  }
  const starts = Array.from({ length: block.weekCount }, (_, i) =>
    addDays(block.startDate, i * 7),
  );
  const weekRows = await db.rows("week").bulkGet(starts.map(weekId));
  return {
    weeks: starts.map((start, i) => {
      const week = weekRows[i];
      return {
        start,
        number: i + 1,
        type: week && week.deletedAt === null ? week.type : null,
      };
    }),
    earlier: blocks[index - 1]?.startDate ?? null,
    later: blocks[index + 1]?.startDate ?? null,
  };
}

/** Heaviest load (in `unit`), then most reps. Loaded sets beat unloaded ones. */
function heavier(a: SetLog, b: SetLog, unit: WeightUnit): boolean {
  const load = (s: SetLog) =>
    s.loadValue !== null && s.loadUnit
      ? toWeightUnit({ value: s.loadValue, unit: s.loadUnit }, unit)
      : -1;
  return load(a) !== load(b) ? load(a) > load(b) : a.reps > b.reps;
}

const bySlot = (a: PlannedSession, b: PlannedSession) =>
  a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot);

/**
 * Everything the log grid shows for `weeks`: per exercise and week the top
 * working set and the planned target (§6.7), and weekly running and climbing
 * totals against the plan.
 */
export async function readGrid(
  db: LocalDb,
  weeks: readonly string[],
  units: GridUnits,
): Promise<LogGrid> {
  const first = weeks[0] ?? "";
  const last = addDays(weeks[weeks.length - 1] ?? first, 6);
  const within = (date: string) => date >= first && date <= last;
  const weekOf = (date: string) => weeks.indexOf(weekStartOf(date));

  const [sessions, items, logs] = await Promise.all([
    db.rows("planned_session").toArray(),
    db.rows("planned_item").toArray(),
    db.rows("session_log").toArray(),
  ]);
  const planned = live(sessions)
    .filter((s) => s.status !== "moved" && within(s.date))
    .sort(bySlot);
  const logged = live(logs).filter((l) => within(l.localDate));
  const logIds = new Set(logged.map((l) => l.id));
  const logById = new Map(logged.map((l) => [l.id, l]));
  const [sets, runs, ascents] = await Promise.all([
    db.rows("set_log").toArray(),
    db.rows("run_log").toArray(),
    db.rows("ascent").toArray(),
  ]);
  const inLogs = <T extends { sessionLogId: string; deletedAt: number | null }>(
    rows: T[],
  ) => live(rows).filter((r) => logIds.has(r.sessionLogId));

  return {
    lift: await liftRows(
      db,
      weeks,
      planned.filter((s) => s.modality === "lift"),
      live(items),
      inLogs(sets).filter((s) => !s.isWarmup),
      logById,
      weekOf,
      units.weightUnit,
    ),
    run: weeks.map((_, w) => {
      const done = logged
        .filter((l) => l.modality === "run" && weekOf(l.localDate) === w)
        .flatMap((l) => latestRun(inLogs(runs), l.id) ?? []);
      const distances = done.map((r) =>
        r.distanceValue === null
          ? 0
          : toDistanceUnit(
              { value: r.distanceValue, unit: r.distanceUnit },
              units.distanceUnit,
            ),
      );
      const plannedRuns = planned.filter(
        (s) => s.modality === "run" && weekOf(s.date) === w,
      );
      const plannedIds = new Set(plannedRuns.map((s) => s.id));
      const plannedDistance = live(items)
        .filter((i) => plannedIds.has(i.plannedSessionId))
        .reduce((sum, i) => {
          const d = (i.targets as RunTargets).distance;
          return sum + (d ? toDistanceUnit(d, units.distanceUnit) : 0);
        }, 0);
      return {
        runs: done.length,
        planned: plannedRuns.length,
        distance: distances.reduce((a, b) => a + b, 0),
        plannedDistance,
        longest: Math.max(0, ...distances),
        durationSec: done.reduce((sum, r) => sum + (r.durationSec ?? 0), 0),
      };
    }),
    climb: weeks.map((_, w) => {
      const done = logged.filter(
        (l) => l.modality === "climb" && weekOf(l.localDate) === w,
      );
      const ids = new Set(done.map((l) => l.id));
      const climbs: Ascent[] = inLogs(ascents).filter((a) =>
        ids.has(a.sessionLogId),
      );
      return {
        sessions: done.filter((l) => l.endedAt !== null).length,
        planned: planned.filter(
          (s) => s.modality === "climb" && weekOf(s.date) === w,
        ).length,
        sends: climbs.filter((a) => isSend(a.style)).length,
        attempts: climbs.reduce((sum, a) => sum + a.attempts, 0),
        hardest: CLIMB_DISCIPLINES.flatMap((d) => hardestSend(climbs, d) ?? []),
      };
    }),
  };
}

async function liftRows(
  db: LocalDb,
  weeks: readonly string[],
  sessions: PlannedSession[],
  items: PlannedItem[],
  sets: SetLog[],
  logById: Map<string, SessionLog>,
  weekOf: (date: string) => number,
  unit: WeightUnit,
): Promise<LiftRow[]> {
  const rows = new Map<string, LiftCell[]>();
  const cells = (exerciseId: string) => {
    let row = rows.get(exerciseId);
    if (!row) {
      row = weeks.map(() => ({ target: null, top: null }));
      rows.set(exerciseId, row);
    }
    return row;
  };
  // Planned exercises first, in plan order; then any only logged.
  for (const session of sessions) {
    const w = weekOf(session.date);
    const planned = items
      .filter(
        (i) =>
          i.plannedSessionId === session.id &&
          i.kind === "exercise" &&
          i.exerciseId !== null,
      )
      .sort((a, b) => a.position - b.position);
    for (const item of planned) {
      const cell = cells(item.exerciseId!)[w]!;
      cell.target ??= item.targets as LiftTargets;
    }
  }
  const ordered = [...sets].sort(
    (a, b) =>
      logById
        .get(a.sessionLogId)!
        .localDate.localeCompare(logById.get(b.sessionLogId)!.localDate) ||
      a.index - b.index,
  );
  for (const set of ordered) {
    const cell = cells(set.exerciseId)[
      weekOf(logById.get(set.sessionLogId)!.localDate)
    ]!;
    if (!cell.top || heavier(set, cell.top, unit)) cell.top = set;
  }
  const exercises = await db.rows("exercise").bulkGet([...rows.keys()]);
  return [...rows].map(([exerciseId, row], i) => ({
    exerciseId,
    name: exercises[i]?.name ?? "Unknown exercise",
    bodyweight: isBodyweight(exercises[i] ?? null),
    cells: row,
  }));
}
