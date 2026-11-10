import {
  formatAmount,
  type ClimbPrescription,
  type LiftItem,
  type RunPrescription,
} from "@workout-app/engine";
import {
  addDays,
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
import { latestMoves, placeSession, type Placement } from "./moves";

/** A planned session with what the screens show about it. */
export type SessionView = {
  /** The session where it sits now, after any move by hand. */
  session: PlannedSession;
  /** Where the plan put it. */
  planned: Placement;
  title: string;
  /** Live items, in order. */
  items: PlannedItem[];
  /** Names of the items' exercises, by id. */
  exerciseNames: Map<string, string>;
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
export function liftDetail(t: LiftTargets): string {
  const reps =
    t.repMin === t.repMax ? `${t.repMin}` : `${t.repMin}–${t.repMax}`;
  return [
    `${t.sets} × ${reps}`,
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

type Placed = Pick<SessionView, "session" | "planned">;

/** Live sessions, not marked `moved`, where they sit now. */
async function placedSessions(): Promise<Placed[]> {
  const moves = latestMoves(await localDb.rows("plan_override").toArray());
  return (await localDb.rows("planned_session").toArray())
    .filter((s) => s.deletedAt === null && s.status !== "moved")
    .map((s) => ({
      session: placeSession(s, moves),
      planned: { date: s.date, slot: s.slot },
    }));
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

/** "Nov 9 – Nov 15" for the week starting `weekStart`. */
export function formatWeekRange(weekStart: string): string {
  const format = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${format.format(utc(weekStart))} – ${format.format(utc(addDays(weekStart, 6)))}`;
}

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
  return placed.map(({ session, planned }) => ({
    session,
    planned,
    title: sessionTitle(
      session,
      (session.templateId && names.get(session.templateId)) || null,
    ),
    items: items.filter((i) => i.plannedSessionId === session.id),
    exerciseNames,
  }));
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
  const tally = (start: string): WeekTally => {
    const count = (modality: Modality) => ({
      planned: placed.filter(
        (p) => p.session.modality === modality && inWeek(start, p.session.date),
      ).length,
      done: logs.filter(
        (l) => l.modality === modality && inWeek(start, l.localDate),
      ).length,
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
  const session = await localDb.rows("planned_session").get(id);
  if (!session || session.deletedAt !== null) return null;
  const moves = latestMoves(await localDb.rows("plan_override").toArray());
  return (
    await views([
      {
        session: placeSession(session, moves),
        planned: { date: session.date, slot: session.slot },
      },
    ])
  )[0]!;
}
