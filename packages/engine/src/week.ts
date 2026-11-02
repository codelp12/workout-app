import {
  addDays,
  blockId,
  daysBetween,
  defaultTemplateId,
  plannedItemId,
  plannedSessionId,
  weekId,
  type Ascent,
  type Block,
  type DaySlot,
  type Intent,
  type PlannedItemKind,
  type RunLog,
  type SessionLog,
  type SetLog,
  type Settings,
  type Template,
  type UpsertData,
  type WeekType,
} from "@workout-app/shared";
import {
  ENGINE_CONFIG,
  type ClimbWorkoutType,
  type EngineConfig,
  type RunWorkoutType,
} from "./config.js";
import { climbStub, type ClimbSessionLog } from "./stubs/climb.js";
import {
  liftStub,
  type LiftExercise,
  type LiftSessionLog,
} from "./stubs/lift.js";
import { runStub, type RunSessionLog } from "./stubs/run.js";
import type { EngineContext, Reason } from "./types.js";

/** Stored as `engineVersion` on generated blocks and weeks. */
export const PLAN_VERSION = "stub-1";

type SessionSpec = {
  /** Stable within a week; part of the session's id. */
  key: string;
  weekday: number;
  slot: DaySlot;
} & (
  | { modality: "lift"; template: string }
  | { modality: "run"; workoutType: RunWorkoutType | "quality"; intent: Intent }
  | { modality: "climb"; workoutType: ClimbWorkoutType; intent: Intent }
);

/**
 * The fixed Phase 1 week until the scheduler lands (SPEC §5.4): 11 sessions,
 * 6 lifts, 3 runs and 2 climbs, with Saturday lift-free. It meets the hard
 * constraints and avoids the high soft penalties: no quality or long run
 * within a day after Legs, no Legs the day after the long run, and no limit
 * climb on or the day after a Pull day.
 */
export const DEFAULT_WEEK: readonly SessionSpec[] = [
  {
    key: "legs_a",
    weekday: 1,
    slot: "pm",
    modality: "lift",
    template: "legs_a",
  },
  {
    key: "push_a",
    weekday: 2,
    slot: "am",
    modality: "lift",
    template: "push_a",
  },
  {
    key: "volume",
    weekday: 2,
    slot: "pm",
    modality: "climb",
    workoutType: "volume",
    intent: "support",
  },
  {
    key: "quality",
    weekday: 3,
    slot: "am",
    modality: "run",
    workoutType: "quality",
    intent: "key",
  },
  {
    key: "pull_a",
    weekday: 3,
    slot: "pm",
    modality: "lift",
    template: "pull_a",
  },
  {
    key: "easy",
    weekday: 4,
    slot: "am",
    modality: "run",
    workoutType: "easy",
    intent: "support",
  },
  {
    key: "legs_b",
    weekday: 4,
    slot: "pm",
    modality: "lift",
    template: "legs_b",
  },
  {
    key: "push_b",
    weekday: 5,
    slot: "am",
    modality: "lift",
    template: "push_b",
  },
  {
    key: "limit",
    weekday: 5,
    slot: "pm",
    modality: "climb",
    workoutType: "limit",
    intent: "key",
  },
  {
    key: "long",
    weekday: 6,
    slot: "am",
    modality: "run",
    workoutType: "long",
    intent: "key",
  },
  {
    key: "pull_b",
    weekday: 7,
    slot: "am",
    modality: "lift",
    template: "pull_b",
  },
];

type Live = { deletedAt: number | null };

export type PlanLogs = {
  lift: LiftSessionLog[];
  run: RunSessionLog[];
  climb: ClimbSessionLog[];
};

/** Groups synced log rows into each engine's session logs, skipping deleted rows. */
export function groupLogs(rows: {
  sessions: readonly (Pick<SessionLog, "id" | "modality" | "localDate"> &
    Live)[];
  sets: readonly (LiftSessionLog["sets"][number] &
    Pick<SetLog, "sessionLogId"> &
    Live)[];
  runs: readonly (RunSessionLog["run"] & Pick<RunLog, "sessionLogId"> & Live)[];
  ascents: readonly (Pick<Ascent, "sessionLogId" | "grade" | "style"> & Live)[];
}): PlanLogs {
  const live = <T extends Live>(list: readonly T[]) =>
    list.filter((r) => r.deletedAt === null);
  const bySession = <T extends { sessionLogId: string }>(
    list: readonly T[],
  ) => {
    const map = new Map<string, T[]>();
    for (const row of list) {
      map.set(row.sessionLogId, [...(map.get(row.sessionLogId) ?? []), row]);
    }
    return map;
  };
  const sets = bySession(live(rows.sets));
  const runs = bySession(live(rows.runs));
  const ascents = bySession(live(rows.ascents));
  const logs: PlanLogs = { lift: [], run: [], climb: [] };
  const sessions = [...live(rows.sessions)].sort((a, b) =>
    a.localDate.localeCompare(b.localDate),
  );
  for (const s of sessions) {
    const session = { localDate: s.localDate };
    if (s.modality === "lift") {
      logs.lift.push({ session, sets: sets.get(s.id) ?? [] });
    } else if (s.modality === "run") {
      for (const run of runs.get(s.id) ?? []) logs.run.push({ session, run });
    } else if (s.modality === "climb") {
      logs.climb.push({ session, ascents: ascents.get(s.id) ?? [] });
    }
  }
  return logs;
}

export type WeekPlanInput = {
  /** The Monday of the week to plan. */
  weekStart: string;
  /** Stamped on the rows as `createdAt` and `updatedAt`. */
  now: number;
  blocks: readonly (Pick<Block, "id" | "startDate" | "weekCount"> & Live)[];
  settings: Pick<
    Settings,
    "weightUnit" | "distanceUnit" | "equipment" | "availability" | "onboarding"
  >;
  templates: readonly Template[];
  exercises: readonly LiftExercise[];
  logs: PlanLogs;
  config?: EngineConfig;
};

export type WeekPlan = {
  /** A new block, when the week doesn't fall in an existing one. */
  block: UpsertData<"block"> | null;
  week: UpsertData<"week">;
  sessions: UpsertData<"planned_session">[];
  items: UpsertData<"planned_item">[];
};

function blockFor(input: WeekPlanInput, config: EngineConfig) {
  const containing = input.blocks
    .filter((b) => {
      const days = daysBetween(b.startDate, input.weekStart);
      return b.deletedAt === null && days >= 0 && days < b.weekCount * 7;
    })
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  if (containing) {
    return {
      id: containing.id,
      weekCount: containing.weekCount,
      index: Math.floor(daysBetween(containing.startDate, input.weekStart) / 7),
      created: null,
    };
  }
  const created: UpsertData<"block"> = {
    id: blockId(input.weekStart),
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
    name: null,
    startDate: input.weekStart,
    weekCount: config.calendar.blockWeeks,
    engineVersion: PLAN_VERSION,
  };
  return { id: created.id, weekCount: created.weekCount, index: 0, created };
}

/**
 * Plans a week from the stubs (SPEC §3.2, §5.4): the block calendar position,
 * then {@link DEFAULT_WEEK}'s sessions with targets and reasons. Pure, and the
 * same inputs give the same ids, so the phone's provisional week and the
 * server's line up.
 */
export function planWeek(input: WeekPlanInput): WeekPlan {
  const config = input.config ?? ENGINE_CONFIG;
  const { now, weekStart, settings } = input;
  const block = blockFor(input, config);
  const type: WeekType =
    block.weekCount > 1 && block.index === block.weekCount - 1
      ? "deload"
      : "loading";
  const week: UpsertData<"week"> = {
    id: weekId(weekStart),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    blockId: block.id,
    index: block.index,
    startDate: weekStart,
    type,
    engineVersion: PLAN_VERSION,
  };

  let lift = liftStub.initState(settings.onboarding);
  for (const log of input.logs.lift) lift = liftStub.update(lift, log);
  let run = runStub.initState(settings.onboarding);
  for (const log of input.logs.run) run = runStub.update(run, log);
  let climb = climbStub.initState(settings.onboarding);
  for (const log of input.logs.climb) climb = climbStub.update(climb, log);

  const taken = new Set<string>();
  const sessions: UpsertData<"planned_session">[] = [];
  const items: UpsertData<"planned_item">[] = [];

  for (const spec of DEFAULT_WEEK) {
    const date = addDays(weekStart, spec.weekday - 1);
    const id = plannedSessionId(weekStart, spec.key);
    const ctx: EngineContext = {
      date,
      weekType: type,
      readiness: "green",
      weightUnit: settings.weightUnit,
      distanceUnit: settings.distanceUnit,
      equipment: settings.equipment,
      config,
    };
    const targets: {
      kind: PlannedItemKind;
      exerciseId: string | null;
      targets: Record<string, unknown>;
      reasons: Reason[];
    }[] = [];
    let workoutType: string;
    let intent: Intent;
    let templateId: string | null = null;
    let version: string;

    if (spec.modality === "lift") {
      const template = input.templates.find(
        (t) =>
          t.id === defaultTemplateId(spec.template) && t.deletedAt === null,
      );
      workoutType = spec.key;
      intent = template?.intent ?? "support";
      version = liftStub.version;
      if (template) {
        templateId = template.id;
        const prescription = liftStub.prescribe(
          lift,
          {
            name: template.name,
            slots: template.slots,
            exercises: input.exercises,
          },
          ctx,
        );
        for (const { exerciseId, reasons, ...rest } of prescription.items) {
          targets.push({
            kind: "exercise",
            exerciseId,
            targets: rest,
            reasons,
          });
        }
      }
    } else if (spec.modality === "run") {
      const runType: RunWorkoutType =
        spec.workoutType === "quality"
          ? block.index % 2 === 0
            ? "threshold"
            : "intervals"
          : spec.workoutType;
      workoutType = runType;
      intent = spec.intent;
      version = runStub.version;
      const { reasons, ...rest } = runStub.prescribe(
        run,
        { workoutType: runType },
        ctx,
      );
      targets.push({
        kind: "run_segment",
        exerciseId: null,
        targets: rest,
        reasons,
      });
    } else {
      workoutType = spec.workoutType;
      intent = spec.intent;
      version = climbStub.version;
      const { reasons, ...rest } = climbStub.prescribe(
        climb,
        { workoutType: spec.workoutType },
        ctx,
      );
      targets.push({
        kind: "climb_block",
        exerciseId: null,
        targets: rest,
        reasons,
      });
    }

    sessions.push({
      id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      weekId: week.id,
      date,
      slot: place(spec, date, settings.availability, taken),
      modality: spec.modality,
      workoutType,
      templateId,
      intent,
      status: "planned",
      generatedBy: `engine@${version}`,
    });
    targets.forEach((t, position) =>
      items.push({
        id: plannedItemId(id, position),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        plannedSessionId: id,
        position,
        kind: t.kind,
        exerciseId: t.exerciseId,
        targets: t.targets,
        reasons: t.reasons.map((r) => r.text),
      }),
    );
  }

  return { block: block.created, week, sessions, items };
}

/** The spec's slot, or the day's other slot if only that one is free and available. */
function place(
  spec: SessionSpec,
  date: string,
  availability: Settings["availability"],
  taken: Set<string>,
): DaySlot {
  const day = availability.find((d) => d.weekday === spec.weekday);
  const free = (slot: DaySlot) =>
    !taken.has(`${date}:${slot}`) && (day ? day[slot] : true);
  const other: DaySlot = spec.slot === "am" ? "pm" : "am";
  const slot = !free(spec.slot) && free(other) ? other : spec.slot;
  taken.add(`${date}:${slot}`);
  return slot;
}
