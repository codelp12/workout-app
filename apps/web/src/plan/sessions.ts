import {
  formatAmount,
  type ClimbPrescription,
  type LiftItem,
  type RunPrescription,
} from "@workout-app/engine";
import {
  addDays,
  liftCombinations,
  sessionLogId,
  DAY_SLOTS,
  weekId,
  weekStartOf,
  type DaySlot,
  type Modality,
  type PlannedItem,
  type PlannedSession,
  type Week,
} from "@workout-app/shared";
import { localDb } from "../sync";
import {
  latestMoves,
  placeSession,
  samePlacement,
  type Placement,
} from "./moves";

/** A planned session with what the screens show about it. */
export type SessionView = {
  /** The session where it sits now, after any move by hand. */
  session: PlannedSession;
  /** Where the plan put it. */
  planned: Placement;
  inProgress: boolean;
  title: string;
  /** Live items, in order. */
  items: PlannedItem[];
  /** Names of the items' exercises, by id. */
  exerciseNames: Map<string, string>;
  combinedWith?: string;
  combineCandidate?: { id: string; title: string };
};

// Item targets are the engine's prescription minus its reasons (#47).
export type LiftTargets = Omit<LiftItem, "exerciseId" | "reasons">;
export type RunTargets = Omit<RunPrescription, "reasons">;
export type ClimbTargets = Omit<ClimbPrescription, "reasons">;

const WORKOUT_NAMES: Record<string, string> = {
  easy: "Easy run",
  threshold: "Threshold run",
  intervals: "Intervals",
  long: "Long run",
  limit: "Limit climb",
  volume: "Volume climb",
};

const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/** "Push A" from the template, else from the workout type (`push_a` → "Push A"). */
export function sessionTitle(
  session: Pick<PlannedSession, "workoutType">,
  templateName: string | null,
): string {
  if (templateName) return templateName;
  return (
    WORKOUT_NAMES[session.workoutType] ??
    session.workoutType
      .split("_")
      .map((word) => (word.length === 1 ? word.toUpperCase() : word))
      .map(capitalize)
      .join(" ")
  );
}

/** `3`, or `3–5` for a real range. */
export const formatRange = <T extends number | string>({
  min,
  max,
}: {
  min: T;
  max: T;
}) => (min === max ? `${min}` : `${min}–${max}`);

const formatRest = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/** `3 × 6–10 · 60 lb · RIR 2 · rest 2:30` */
export function liftDetail(t: LiftTargets, timed = false): string {
  const reps =
    t.repMin === t.repMax ? `${t.repMin}` : `${t.repMin}–${t.repMax}`;
  return [
    `${t.sets} × ${reps}${timed ? " s" : ""}`,
    t.load && formatAmount(t.load.value, t.load.unit),
    t.band,
    t.targetRir !== null && `RIR ${t.targetRir}`,
    `rest ${formatRest(t.restSec)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One line about a session's targets for the Today card. */
export function sessionSummary({ session, items }: SessionView): string {
  if (session.modality === "lift") {
    const exercises = items.filter((i) => i.kind === "exercise");
    if (exercises.length === 0) return "No exercises yet";
    const sets = exercises.reduce(
      (sum, i) => sum + (i.targets as LiftTargets).sets,
      0,
    );
    return `${exercises.length} exercise${exercises.length === 1 ? "" : "s"} · ${sets} sets`;
  }
  const targets = items[0]?.targets;
  if (session.modality === "run" && targets) {
    const run = targets as RunTargets;
    return [
      run.distance && formatAmount(run.distance.value, run.distance.unit),
      `RPE ${formatRange(run.targetRpe)}`,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (session.modality === "climb" && targets) {
    const climb = targets as ClimbTargets;
    return [
      climb.grades && formatRange(climb.grades),
      `${formatRange(climb.problems)} problems`,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return "";
}

/** "Monday, November 9" for a `YYYY-MM-DD` date. */
export function formatLongDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(Date.UTC(y!, m! - 1, d));
}

type Placed = Pick<
  SessionView,
  "session" | "planned" | "combinedWith" | "inProgress"
> & {
  combinedInto?: string;
  started: boolean;
};

/**
 * Marks a planned session `done` once its log is finished. The server owns
 * plan rows, so the client works this out from the log instead of writing it.
 */
async function placedSessions(includeMoved = false): Promise<Placed[]> {
  const overrides = await localDb.rows("plan_override").toArray();
  const logs = await localDb.rows("session_log").toArray();
  const moves = latestMoves(overrides);
  const sessions = (await localDb.rows("planned_session").toArray()).filter(
    (s) => s.deletedAt === null && (includeMoved || s.status !== "moved"),
  );
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const byLogId = new Map(
    logs.filter((l) => l.deletedAt === null).map((l) => [l.id, l]),
  );
  const pairs = liftCombinations(
    overrides,
    sessions,
    logs,
    await localDb.rows("set_log").toArray(),
  );
  const absorbed = new Map(
    [...pairs].map(([primary, other]) => [other, primary]),
  );
  return sessions.map((s) => {
    const combinedInto = absorbed.get(s.id);
    const primary = combinedInto ? byId.get(combinedInto)! : s;
    const log = byLogId.get(sessionLogId(primary.id));
    const finished = log != null && log.endedAt !== null;
    const { date, slot } = placeSession(primary, moves);
    return {
      session: {
        ...s,
        date,
        slot,
        status: finished && s.status === "planned" ? "done" : s.status,
      },
      planned: { date: s.date, slot: s.slot },
      combinedWith: pairs.get(s.id),
      combinedInto,
      started: log != null,
      inProgress: s.status === "planned" && log?.endedAt === null,
    };
  });
}

const utc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d);
};

/** "Mon 9" for a `YYYY-MM-DD` date. */
export function formatShortDay(date: string): string {
  const parts = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  }).formatToParts(utc(date));
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("weekday")} ${part("day")}`;
}

/** "Nov 9 – Dec 6" from `from` to `to`, inclusive. */
export function formatDateRange(from: string, to: string): string {
  const format = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${format.format(utc(from))} – ${format.format(utc(to))}`;
}

/** "Nov 9 – Nov 15" for the week starting `weekStart`. */
export const formatWeekRange = (weekStart: string) =>
  formatDateRange(weekStart, addDays(weekStart, 6));

async function views(placed: Placed[]): Promise<SessionView[]> {
  const sessions = placed.map((p) => p.session);
  const ids = new Set(sessions.map((s) => s.id));
  const items = (await localDb.rows("planned_item").toArray())
    .filter((i) => i.deletedAt === null && ids.has(i.plannedSessionId))
    .sort((a, b) => a.position - b.position);
  const templates = await localDb
    .rows("template")
    .bulkGet(sessions.flatMap((s) => (s.templateId ? [s.templateId] : [])));
  const names = new Map(
    templates.flatMap((t) =>
      t && t.deletedAt === null ? [[t.id, t.name]] : [],
    ),
  );
  const exercises = await localDb
    .rows("exercise")
    .bulkGet(items.flatMap((i) => (i.exerciseId ? [i.exerciseId] : [])));
  const exerciseNames = new Map(
    exercises.flatMap((e) => (e ? [[e.id, e.name]] : [])),
  );
  const titleOf = (s: PlannedSession) =>
    sessionTitle(s, (s.templateId && names.get(s.templateId)) || null);
  const available = ({
    session,
    combinedInto,
    combinedWith,
    started,
  }: Placed) =>
    session.modality === "lift" &&
    session.status === "planned" &&
    !started &&
    !combinedInto &&
    !combinedWith;
  return placed
    .filter((p) => !p.combinedInto)
    .map((p) => {
      const { session, planned, combinedWith, inProgress } = p;
      const other = combinedWith && sessions.find((s) => s.id === combinedWith);
      const candidates = available(p)
        ? placed.filter(
            (next) =>
              next !== p &&
              available(next) &&
              samePlacement(session, next.session),
          )
        : [];
      const candidate =
        candidates.length === 1 ? candidates[0]!.session : undefined;
      return {
        session,
        planned,
        combinedWith,
        inProgress,
        combineCandidate: candidate && {
          id: candidate.id,
          title: titleOf(candidate),
        },
        title: other
          ? `${titleOf(session)} + ${titleOf(other)}`
          : titleOf(session),
        items: [
          ...items.filter((i) => i.plannedSessionId === session.id),
          ...items.filter((i) => i.plannedSessionId === combinedWith),
        ],
        exerciseNames,
      };
    });
}

export type DayPlan = {
  /** The week `date` falls in, if it's been planned. */
  week: Week | null;
  slots: Record<DaySlot, SessionView[]>;
};

const bySlot = (all: SessionView[]) =>
  Object.fromEntries(
    DAY_SLOTS.map((slot) => [
      slot,
      all
        .filter((v) => v.session.slot === slot)
        .sort((a, b) => a.session.modality.localeCompare(b.session.modality)),
    ]),
  ) as Record<DaySlot, SessionView[]>;

async function readWeek(weekStart: string): Promise<Week | null> {
  const week = await localDb.rows("week").get(weekId(weekStart));
  return week && week.deletedAt === null ? week : null;
}

/**
 * The sessions on `date` by slot, where the owner put them, leaving out
 * deleted ones and ones marked `moved`.
 */
export async function dayPlan(date: string): Promise<DayPlan> {
  const placed = (await placedSessions()).filter(
    (p) => p.session.date === date,
  );
  return {
    week: await readWeek(weekStartOf(date)),
    slots: bySlot(await views(placed)),
  };
}

/** Planned and finished sessions in a week, per modality. */
export type WeekTally = Record<Modality, { planned: number; done: number }>;

export type WeekPlan = {
  week: Week | null;
  /** Monday to Sunday. */
  days: { date: string; slots: Record<DaySlot, SessionView[]> }[];
  tally: { last: WeekTally; current: WeekTally };
};

const inWeek = (weekStart: string, date: string) =>
  date >= weekStart && date <= addDays(weekStart, 6);

/**
 * The week starting Monday `weekStart`, day by day, with the sessions where
 * the owner put them, plus how many were planned and done this week and last.
 * "Done" counts finished session logs on the week's dates.
 */
export async function weekPlan(weekStart: string): Promise<WeekPlan> {
  const placed = await placedSessions();
  const logs = (await localDb.rows("session_log").toArray()).filter(
    (l) => l.deletedAt === null && l.endedAt !== null,
  );
  const absorbed = new Set(
    placed.filter((p) => p.combinedInto).map((p) => p.session.id),
  );
  const tally = (start: string): WeekTally => {
    const count = (modality: Modality) => ({
      planned: placed.filter(
        (p) => p.session.modality === modality && inWeek(start, p.session.date),
      ).length,
      done: logs.reduce((sum, l) => {
        if (
          l.modality !== modality ||
          !inWeek(start, l.localDate) ||
          (l.plannedSessionId !== null && absorbed.has(l.plannedSessionId))
        )
          return sum;
        const combined = placed.some(
          (p) => p.combinedWith && p.session.id === l.plannedSessionId,
        );
        return sum + (combined ? 2 : 1);
      }, 0),
    });
    return {
      lift: count("lift"),
      run: count("run"),
      climb: count("climb"),
      mobility: count("mobility"),
    };
  };
  const all = await views(
    placed.filter((p) => inWeek(weekStart, p.session.date)),
  );
  return {
    week: await readWeek(weekStart),
    days: Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i);
      return {
        date,
        slots: bySlot(all.filter((v) => v.session.date === date)),
      };
    }),
    tally: { last: tally(addDays(weekStart, -7)), current: tally(weekStart) },
  };
}

/** A live planned session where it sits now, or `null` if there's no such session. */
export async function readSession(id: string): Promise<SessionView | null> {
  const placed = await placedSessions(true);
  const row = placed.find((p) => p.session.id === id);
  if (!row) return null;
  const siblings = placed.filter((p) => samePlacement(row.session, p.session));
  return (
    (await views(siblings)).find(
      (v) => v.session.id === (row.combinedInto ?? id),
    ) ?? null
  );
}
