import {
  formatAmount,
  type ClimbPrescription,
  type LiftItem,
  type RunPrescription,
} from "@workout-app/engine";
import {
  DAY_SLOTS,
  weekId,
  weekStartOf,
  type DaySlot,
  type PlannedItem,
  type PlannedSession,
  type Week,
} from "@workout-app/shared";
import { localDb } from "../sync";

/** A planned session with what the screens show about it. */
export type SessionView = {
  session: PlannedSession;
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

async function views(sessions: PlannedSession[]): Promise<SessionView[]> {
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
  return sessions.map((session) => ({
    session,
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

/**
 * The sessions planned on `date` by slot, leaving out deleted ones and ones
 * moved to another day.
 */
export async function dayPlan(date: string): Promise<DayPlan> {
  const week = await localDb.rows("week").get(weekId(weekStartOf(date)));
  const sessions = (await localDb.rows("planned_session").toArray()).filter(
    (s) => s.date === date && s.deletedAt === null && s.status !== "moved",
  );
  const all = await views(sessions);
  const slots = Object.fromEntries(
    DAY_SLOTS.map((slot) => [
      slot,
      all
        .filter((v) => v.session.slot === slot)
        .sort((a, b) => a.session.modality.localeCompare(b.session.modality)),
    ]),
  ) as Record<DaySlot, SessionView[]>;
  return { week: week && week.deletedAt === null ? week : null, slots };
}

/** A live planned session, or `null` if there's no such session. */
export async function readSession(id: string): Promise<SessionView | null> {
  const session = await localDb.rows("planned_session").get(id);
  if (!session || session.deletedAt !== null) return null;
  return (await views([session]))[0]!;
}
