import {
  type Ascent,
  type ClimbDiscipline,
  type RunLog,
  type SessionLog,
  type SetLog,
} from "@workout-app/shared";
import { modalityStyles } from "../modality";
import { sessionTitle } from "../plan/sessions";
import {
  disciplineOf,
  hardestSend,
  isSend,
  plural,
} from "../players/climb-log";
import { runFacts } from "../players/run-log";
import type { LocalDb } from "../sync/local-db";

/** One logged session, as the Log list shows it. */
export type HistoryEntry = {
  log: SessionLog;
  title: string;
  /** One line about what was done, e.g. "4 exercises · 12 sets · 52 min". */
  summary: string;
};

/** An exercise of a logged lift session, in the order it was done. */
export type LoggedExercise = {
  exerciseId: string;
  name: string;
  sets: SetLog[];
  warmups: SetLog[];
};

/** A logged session with everything logged in it. */
export type HistoryDetail = HistoryEntry & {
  exercises: LoggedExercise[];
  run: RunLog | null;
  /** Oldest first. */
  ascents: Ascent[];
  /** Names of the ascents' projects, by id. */
  projectNames: Map<string, string>;
};

const live = <T extends { deletedAt: number | null }>(rows: T[]) =>
  rows.filter((r) => r.deletedAt === null);

/** Whole minutes from start to end, or null while it's still going. */
export function minutesOf(log: SessionLog): number | null {
  if (log.endedAt === null) return null;
  return Math.max(1, Math.round((log.endedAt - log.startedAt) / 60_000));
}

type Logged = {
  sets: SetLog[];
  runs: RunLog[];
  ascents: Ascent[];
};

async function readLogged(db: LocalDb, logIds: Set<string>): Promise<Logged> {
  const mine = <T extends { sessionLogId: string; deletedAt: number | null }>(
    rows: T[],
  ) => live(rows).filter((r) => logIds.has(r.sessionLogId));
  return {
    sets: mine(await db.rows("set_log").toArray()),
    runs: mine(await db.rows("run_log").toArray()),
    ascents: mine(await db.rows("ascent").toArray()),
  };
}

/** The latest run logged for a session; re-logging a run adds a newer row. */
const latestRun = (runs: RunLog[], logId: string) =>
  runs
    .filter((r) => r.sessionLogId === logId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;

/** Sends and hardest send per grade scale, e.g. "5 sends · hardest V4". */
function climbFacts(ascents: Ascent[]): string[] {
  const disciplines = new Set(
    ascents.flatMap((a) => {
      const d = disciplineOf(a.grade);
      return d ? [d] : [];
    }),
  );
  const hardest = [...disciplines].sort().flatMap((d: ClimbDiscipline) => {
    const send = hardestSend(ascents, d);
    return send ? [send] : [];
  });
  const sends = ascents.filter((a) => isSend(a.style)).length;
  return [
    plural(sends, "send"),
    ...(hardest.length > 0 ? [`hardest ${hardest.join(", ")}`] : []),
  ];
}

function summarize(log: SessionLog, logged: Logged): string {
  const minutes = minutesOf(log);
  const time = minutes === null ? [] : [`${minutes} min`];
  switch (log.modality) {
    case "run": {
      const run = latestRun(logged.runs, log.id);
      if (!run) return "No run logged";
      // The workout type is already the title.
      return runFacts(run).facts.slice(1).join(" · ");
    }
    case "climb": {
      const ascents = logged.ascents.filter((a) => a.sessionLogId === log.id);
      return [...climbFacts(ascents), ...time].join(" · ");
    }
    default: {
      const sets = logged.sets.filter(
        (s) => s.sessionLogId === log.id && !s.isWarmup,
      );
      if (sets.length === 0) return ["No sets logged", ...time].join(" · ");
      const exercises = new Set(sets.map((s) => s.exerciseId)).size;
      return [
        plural(exercises, "exercise"),
        plural(sets.length, "set"),
        ...time,
      ].join(" · ");
    }
  }
}

/** "Push A" from the planned session, else from the run's type or the modality. */
async function titles(
  db: LocalDb,
  logs: SessionLog[],
  runs: RunLog[],
): Promise<Map<string, string>> {
  const planned = await db
    .rows("planned_session")
    .bulkGet(
      logs.flatMap((l) => (l.plannedSessionId ? [l.plannedSessionId] : [])),
    );
  const sessions = new Map(planned.flatMap((s) => (s ? [[s.id, s]] : [])));
  const templates = await db
    .rows("template")
    .bulkGet(
      [...sessions.values()].flatMap((s) =>
        s.templateId ? [s.templateId] : [],
      ),
    );
  const templateNames = new Map(
    templates.flatMap((t) =>
      t && t.deletedAt === null ? [[t.id, t.name]] : [],
    ),
  );
  return new Map(
    logs.map((log) => {
      const session = log.plannedSessionId
        ? sessions.get(log.plannedSessionId)
        : undefined;
      const run = latestRun(runs, log.id);
      const title = session
        ? sessionTitle(
            session,
            (session.templateId && templateNames.get(session.templateId)) ||
              null,
          )
        : run
          ? sessionTitle(run, null)
          : `${modalityStyles[log.modality].label} session`;
      return [log.id, title];
    }),
  );
}

/** Every logged session, newest first, including ones not finished yet. */
export async function readHistory(db: LocalDb): Promise<HistoryEntry[]> {
  const logs = live(await db.rows("session_log").toArray()).sort(
    (a, b) =>
      b.localDate.localeCompare(a.localDate) || b.startedAt - a.startedAt,
  );
  const logged = await readLogged(db, new Set(logs.map((l) => l.id)));
  const names = await titles(db, logs, logged.runs);
  return logs.map((log) => ({
    log,
    title: names.get(log.id)!,
    summary: summarize(log, logged),
  }));
}

/** A logged session with its sets, run or climbs, or null if there's no such log. */
export async function readHistoryDetail(
  db: LocalDb,
  logId: string,
): Promise<HistoryDetail | null> {
  const log = await db.rows("session_log").get(logId);
  if (!log || log.deletedAt !== null) return null;
  const logged = await readLogged(db, new Set([log.id]));
  const names = await titles(db, [log], logged.runs);

  const order = (s: SetLog) => s.completedAt ?? s.createdAt;
  const sets = [...logged.sets].sort((a, b) => order(a) - order(b));
  const exerciseIds = [...new Set(sets.map((s) => s.exerciseId))];
  const exercises = await db.rows("exercise").bulkGet(exerciseIds);
  const byIndex = (a: SetLog, b: SetLog) => a.index - b.index;

  const ascents = [...logged.ascents].sort((a, b) => a.createdAt - b.createdAt);
  const projects = await db
    .rows("project")
    .bulkGet([
      ...new Set(ascents.flatMap((a) => (a.projectId ? [a.projectId] : []))),
    ]);

  return {
    log,
    title: names.get(log.id)!,
    summary: summarize(log, logged),
    exercises: exerciseIds.map((exerciseId, i) => {
      const mine = sets.filter((s) => s.exerciseId === exerciseId);
      return {
        exerciseId,
        name: exercises[i]?.name ?? "Unknown exercise",
        sets: mine.filter((s) => !s.isWarmup).sort(byIndex),
        warmups: mine.filter((s) => s.isWarmup).sort(byIndex),
      };
    }),
    run: latestRun(logged.runs, log.id),
    ascents,
    projectNames: new Map(projects.flatMap((p) => (p ? [[p.id, p.name]] : []))),
  };
}

/** "45 min · RPE 7", or "Not finished" for a session still open. */
export function sessionFacts(log: SessionLog): string {
  const minutes = minutesOf(log);
  return [
    minutes === null ? "Not finished" : `${minutes} min`,
    log.rpe !== null && `RPE ${log.rpe}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
