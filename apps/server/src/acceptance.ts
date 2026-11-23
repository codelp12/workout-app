import {
  addDays,
  liftCombinations,
  moveOverrideDataSchema,
  sessionLogId,
  type MoveOverrideData,
} from "@workout-app/shared";
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import type { Db } from "./db.js";
import {
  ascent,
  exercise,
  planOverride,
  plannedSession,
  runLog,
  sessionLog,
  setLog,
  template,
} from "./schema.js";

type PlannedRow = typeof plannedSession.$inferSelect;
type LogRow = typeof sessionLog.$inferSelect;

export type CheckedSession = {
  logId: string;
  date: string;
  slot: string | null;
  modality: string;
  title: string;
  planned: boolean;
  status: "finished" | "unfinished" | "not logged" | "skipped";
  sets: number;
  warmups: number;
  runs: number;
  climbs: number;
};

export type WeekCheck = {
  weekStart: string;
  sessions: CheckedSession[];
  /** Sets logged more than once: same session, exercise, set number and kind. */
  duplicateSets: {
    title: string;
    date: string;
    exercise: string;
    set: number;
    warmup: boolean;
    times: number;
  }[];
};

/** Each session's latest live move, as the app places it (SPEC §5.4). */
function latestMoves(db: Db): Map<string, MoveOverrideData> {
  const latest = new Map<
    string,
    { updatedAt: number; data: MoveOverrideData }
  >();
  const rows = db
    .select()
    .from(planOverride)
    .where(
      and(
        eq(planOverride.kind, "move"),
        isNull(planOverride.deletedAt),
        isNull(planOverride.supersededAt),
      ),
    )
    .all();
  for (const o of rows) {
    const data = moveOverrideDataSchema.safeParse(o.data);
    if (!o.plannedSessionId || !data.success) continue;
    const current = latest.get(o.plannedSessionId);
    if (!current || o.updatedAt > current.updatedAt)
      latest.set(o.plannedSessionId, {
        updatedAt: o.updatedAt,
        data: data.data,
      });
  }
  return new Map([...latest].map(([id, m]) => [id, m.data]));
}

/**
 * The server's record of the week starting Monday `weekStart`, for the Phase 1
 * acceptance week (SPEC §9): each planned session with what was logged for it,
 * any logs with no plan, and sets that appear twice.
 */
export function checkWeek(db: Db, weekStart: string): WeekCheck {
  const weekEnd = addDays(weekStart, 6);
  const inWeek = (date: string) => date >= weekStart && date <= weekEnd;
  const moves = latestMoves(db);
  const candidates = db
    .select()
    .from(plannedSession)
    .where(isNull(plannedSession.deletedAt))
    .all();
  const candidateLogIds = candidates.map((p) => sessionLogId(p.id));
  const logById = new Map(
    db
      .select()
      .from(sessionLog)
      .where(
        and(
          isNull(sessionLog.deletedAt),
          or(
            and(
              gte(sessionLog.localDate, weekStart),
              lte(sessionLog.localDate, weekEnd),
            ),
            inArray(sessionLog.id, candidateLogIds),
          ),
        ),
      )
      .all()
      .map((l) => [l.id, l]),
  );
  const pairs = liftCombinations(
    db
      .select()
      .from(planOverride)
      .where(eq(planOverride.kind, "combine"))
      .all(),
    candidates,
    [...logById.values()],
  );
  const absorbed = new Map(
    [...pairs].map(([primary, other]) => [other, primary]),
  );
  // Where each session ended up: the day it was logged, else where the owner
  // moved it, else where it was planned.
  const byId = new Map(candidates.map((p) => [p.id, p]));
  const planned = candidates.flatMap((p) => {
    const sharedId = absorbed.get(p.id) ?? p.id;
    const log = logById.get(sessionLogId(sharedId));
    if (!log && p.status === "moved") return [];
    const source = byId.get(sharedId)!;
    const move = moves.get(sharedId);
    const placed = {
      ...p,
      date: log?.localDate ?? move?.date ?? source.date,
      slot: move?.slot ?? source.slot,
    };
    return inWeek(placed.date) ? [placed] : [];
  });
  const plannedLogIds = new Set(planned.map((p) => sessionLogId(p.id)));
  const hasPlan = new Set(candidateLogIds);
  const logs = [...logById.values()].filter(
    (l) => inWeek(l.localDate) && !hasPlan.has(l.id),
  );

  const allLogIds = [...new Set([...logs.map((l) => l.id), ...plannedLogIds])];
  const linked = <T extends { sessionLogId: string; deletedAt: number | null }>(
    rows: T[],
  ) => rows.filter((r) => r.deletedAt === null);
  const sets = linked(
    db
      .select()
      .from(setLog)
      .where(inArray(setLog.sessionLogId, allLogIds))
      .all(),
  );
  const runs = linked(
    db
      .select()
      .from(runLog)
      .where(inArray(runLog.sessionLogId, allLogIds))
      .all(),
  );
  const ascents = linked(
    db
      .select()
      .from(ascent)
      .where(inArray(ascent.sessionLogId, allLogIds))
      .all(),
  );
  const templates = new Map(
    db
      .select({ id: template.id, name: template.name })
      .from(template)
      .all()
      .map((t) => [t.id, t.name]),
  );
  const exercises = new Map(
    db
      .select({ id: exercise.id, name: exercise.name })
      .from(exercise)
      .all()
      .map((e) => [e.id, e.name]),
  );

  const describe = (
    logId: string,
    log: LogRow | undefined,
    plan: PlannedRow | undefined,
    countActivity = true,
  ): CheckedSession => {
    const mine = <T extends { sessionLogId: string }>(rows: T[]) =>
      countActivity ? rows.filter((r) => r.sessionLogId === logId) : [];
    const logSets = mine(sets);
    return {
      logId,
      date: log?.localDate ?? plan!.date,
      slot: plan?.slot ?? null,
      modality: plan?.modality ?? log!.modality,
      title: plan
        ? ((plan.templateId && templates.get(plan.templateId)) ??
          plan.workoutType)
        : `Unplanned ${log!.modality}`,
      planned: plan !== undefined,
      status: log
        ? log.endedAt === null
          ? "unfinished"
          : "finished"
        : plan?.status === "skipped"
          ? "skipped"
          : "not logged",
      sets: logSets.filter((s) => !s.isWarmup).length,
      warmups: logSets.filter((s) => s.isWarmup).length,
      runs: mine(runs).length,
      climbs: mine(ascents).length,
    };
  };

  const sessions = [
    ...planned.map((p) => {
      const primary = absorbed.get(p.id);
      const id = sessionLogId(primary ?? p.id);
      return describe(id, logById.get(id), p, !primary);
    }),
    ...logs.map((l) => describe(l.id, l, undefined)),
  ].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.slot ?? "zz").localeCompare(b.slot ?? "zz") ||
      a.title.localeCompare(b.title),
  );

  const byLog = new Map(
    sessions.filter((x) => x.sets + x.warmups > 0).map((x) => [x.logId, x]),
  );
  const counts = new Map<string, typeof sets>();
  for (const s of sets) {
    const key = [s.sessionLogId, s.exerciseId, s.index, s.isWarmup].join("|");
    counts.set(key, [...(counts.get(key) ?? []), s]);
  }
  const duplicateSets = [...counts.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const s = group[0]!;
      const session = byLog.get(s.sessionLogId);
      return {
        title: session?.title ?? "Unknown session",
        date: session?.date ?? "",
        exercise: exercises.get(s.exerciseId) ?? s.exerciseId,
        set: s.index + 1,
        warmup: s.isWarmup,
        times: group.length,
      };
    });

  return { weekStart, sessions, duplicateSets };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function logged(s: CheckedSession): string {
  const parts = [
    s.sets && plural(s.sets, "set"),
    s.warmups && plural(s.warmups, "warm-up"),
    s.runs && plural(s.runs, "run log"),
    s.climbs && plural(s.climbs, "climb"),
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "nothing";
}

/** Markdown to paste on the acceptance issue. */
export function formatWeekCheck({
  weekStart,
  sessions,
  duplicateSets,
}: WeekCheck): string {
  const planned = sessions.filter((s) => s.planned);
  const count = (status: CheckedSession["status"]) =>
    planned.filter((s) => s.status === status).length;
  const unplanned = sessions.length - planned.length;
  const lines = [
    `## Week of ${weekStart}`,
    "",
    `${plural(planned.length, "planned session")}: ${count("finished")} finished, ${count("unfinished")} unfinished, ${count("not logged")} not logged, ${count("skipped")} skipped.` +
      (unplanned ? ` ${plural(unplanned, "unplanned log")}.` : ""),
    "",
    "| Date | Slot | Session | Status | Logged |",
    "| --- | --- | --- | --- | --- |",
    ...sessions.map(
      (s) =>
        `| ${s.date} | ${s.slot ?? ""} | ${s.title} | ${s.status} | ${logged(s)} |`,
    ),
    "",
    duplicateSets.length
      ? `**Duplicate sets: ${duplicateSets.length}**`
      : "Duplicate sets: none.",
    ...duplicateSets.map(
      (d) =>
        `- ${d.date} ${d.title}: ${d.exercise} ${d.warmup ? "warm-up" : "set"} ${d.set}, ${d.times} times`,
    ),
  ];
  return lines.join("\n");
}
