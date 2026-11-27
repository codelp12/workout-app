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
  type Exercise,
  type Intent,
  type PlannedItem,
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
import {
  capRampSets,
  describeLoad,
  layoffReentry,
  rampReason,
  scaleLoad,
  stalledMainLifts,
  weekOneLoad,
  weekScheme,
  type BlockPosition,
  type RampRequest,
} from "./lift/block.js";
import {
  initLiftEngineState,
  updateLiftEngineState,
  type ExerciseState,
  type LiftEngineState,
  LIFT_ENGINE_VERSION,
} from "./lift/state.js";
import { climbStub, type ClimbSessionLog } from "./stubs/climb.js";
import {
  resolveSlots,
  slotReasons,
  type LiftExercise,
  type LiftSessionLog,
  type LiftTarget,
} from "./stubs/lift.js";
import {
  progressExercise,
  type ProgressionExercise,
  type SlotScheme,
} from "./lift/progression.js";
import { runStub, type RunSessionLog } from "./stubs/run.js";
import type { EngineContext, Reason } from "./types.js";

/** Stored as `engineVersion` on generated blocks and weeks. */
export const PLAN_VERSION = "plan-4";

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
 * 6 lifts, 3 runs and 2 climbs, from the owner's weekly training program
 * (DECISIONS.md). Thursday is a rest day. It meets the hard constraints, with
 * no quality or long run within a day after Legs A. By the owner's choice,
 * the climbs share days with the Pull sessions, and Legs B, a light hip
 * session, follows Sunday's long run.
 */
export const DEFAULT_WEEK: readonly SessionSpec[] = [
  {
    key: "easy",
    weekday: 1,
    slot: "am",
    modality: "run",
    workoutType: "easy",
    intent: "support",
  },
  {
    key: "push_a",
    weekday: 1,
    slot: "pm",
    modality: "lift",
    template: "push_a",
  },
  {
    key: "pull_a",
    weekday: 2,
    slot: "am",
    modality: "lift",
    template: "pull_a",
  },
  {
    key: "limit",
    weekday: 2,
    slot: "pm",
    modality: "climb",
    workoutType: "limit",
    intent: "key",
  },
  {
    key: "legs_a",
    weekday: 3,
    slot: "pm",
    modality: "lift",
    template: "legs_a",
  },
  {
    key: "quality",
    weekday: 5,
    slot: "am",
    modality: "run",
    workoutType: "quality",
    intent: "key",
  },
  {
    key: "push_b",
    weekday: 5,
    slot: "pm",
    modality: "lift",
    template: "push_b",
  },
  {
    key: "pull_b",
    weekday: 6,
    slot: "am",
    modality: "lift",
    template: "pull_b",
  },
  {
    key: "volume",
    weekday: 6,
    slot: "pm",
    modality: "climb",
    workoutType: "volume",
    intent: "support",
  },
  {
    key: "long",
    weekday: 7,
    slot: "am",
    modality: "run",
    workoutType: "long",
    intent: "key",
  },
  {
    key: "legs_b",
    weekday: 7,
    slot: "pm",
    modality: "lift",
    template: "legs_b",
  },
];

type Live = { deletedAt: number | null };

export type PlanLogs = {
  lift: LiftSessionLog[];
  run: RunSessionLog[];
  climb: ClimbSessionLog[];
};

/**
 * Groups synced log rows into each engine's session logs, skipping deleted
 * rows. A lift log carries its planned session's exercise targets from
 * `items`, so the engine can judge it (§5.1).
 */
export function groupLogs(rows: {
  sessions: readonly (Pick<
    SessionLog,
    "id" | "modality" | "localDate" | "startedAt"
  > &
    Partial<Pick<SessionLog, "plannedSessionId">> &
    Live)[];
  sets: readonly (LiftSessionLog["sets"][number] &
    Pick<SetLog, "sessionLogId"> &
    Live)[];
  runs: readonly (RunSessionLog["run"] & Pick<RunLog, "sessionLogId"> & Live)[];
  ascents: readonly (Pick<Ascent, "sessionLogId" | "grade" | "style"> & Live)[];
  items?: readonly (Pick<
    PlannedItem,
    "plannedSessionId" | "exerciseId" | "targets"
  > &
    Live)[];
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
  const targets = new Map<string, Record<string, LiftTarget>>();
  for (const item of live(rows.items ?? [])) {
    const target = liftTargetOf(item.targets);
    if (item.exerciseId === null || target === null) continue;
    const forSession = targets.get(item.plannedSessionId) ?? {};
    forSession[item.exerciseId] ??= target;
    targets.set(item.plannedSessionId, forSession);
  }
  const logs: PlanLogs = { lift: [], run: [], climb: [] };
  const sessions = [...live(rows.sessions)].sort(
    (a, b) =>
      a.localDate.localeCompare(b.localDate) || a.startedAt - b.startedAt,
  );
  for (const s of sessions) {
    const session = { localDate: s.localDate };
    if (s.modality === "lift") {
      const planned = s.plannedSessionId
        ? targets.get(s.plannedSessionId)
        : undefined;
      logs.lift.push({
        session,
        sets: sets.get(s.id) ?? [],
        ...(planned ? { targets: planned } : {}),
      });
    } else if (s.modality === "run") {
      for (const run of runs.get(s.id) ?? []) logs.run.push({ session, run });
    } else if (s.modality === "climb") {
      logs.climb.push({ session, ascents: ascents.get(s.id) ?? [] });
    }
  }
  return logs;
}

const num = (v: unknown) => (typeof v === "number" ? v : null);

/** A planned item's stored targets as a lift target, or null when they aren't one. */
function liftTargetOf(targets: Record<string, unknown>): LiftTarget | null {
  const sets = num(targets.sets);
  const repMin = num(targets.repMin);
  const repMax = num(targets.repMax);
  if (sets === null || repMin === null || repMax === null) return null;
  const load = targets.load as { value?: unknown; unit?: unknown } | null;
  return {
    sets,
    repMin,
    repMax,
    targetRir: num(targets.targetRir),
    load:
      load &&
      typeof load.value === "number" &&
      (load.unit === "kg" || load.unit === "lb")
        ? { value: load.value, unit: load.unit }
        : null,
    band: typeof targets.band === "string" ? targets.band : null,
    ...(typeof targets.rampSets === "number"
      ? { rampSets: targets.rampSets }
      : targets.ramp === true
        ? { rampSets: 0 }
        : {}),
  };
}

/** A lift exercise with what the block calendar needs (main lift, muscles). */
export type PlanExercise = LiftExercise &
  Pick<Exercise, "progressionModel" | "primaryMuscles" | "increment">;

export type WeekPlanInput = {
  /** The Monday of the week to plan. */
  weekStart: string;
  /** Stamped on the rows as `createdAt` and `updatedAt`. */
  now: number;
  blocks: readonly (Pick<
    Block,
    "id" | "createdAt" | "name" | "startDate" | "weekCount" | "engineVersion"
  > &
    Live)[];
  settings: Pick<
    Settings,
    "weightUnit" | "distanceUnit" | "equipment" | "availability" | "onboarding"
  >;
  templates: readonly Template[];
  exercises: readonly PlanExercise[];
  logs: PlanLogs;
  config?: EngineConfig;
};

export type WeekPlan = {
  /**
   * A new block when the week doesn't fall in an existing one, or the
   * current block shortened by an early deload; otherwise null.
   */
  block: UpsertData<"block"> | null;
  week: UpsertData<"week">;
  sessions: UpsertData<"planned_session">[];
  items: UpsertData<"planned_item">[];
  decisions: EngineDecision[];
};

export type EngineDecision = {
  plannedItemId: string;
  engineVersion: string;
  inputs: {
    date: string;
    weekType: WeekType;
    blockIndex: number;
    slot: Template["slots"][number];
    scheme: SlotScheme;
    exerciseId: string | null;
    state: ExerciseState | null;
    layoffCut: number | null;
  };
  rules: string[];
  outputs: {
    exerciseId: string | null;
    targets: Record<string, unknown>;
    reasons: string[];
  };
};

const weekTypeAt = (index: number, weekCount: number): WeekType =>
  weekCount > 1 && index === weekCount - 1 ? "deload" : "loading";

/**
 * The week's place on the global calendar (SPEC §5.1, §5.4). When two or
 * more main lifts stalled earlier in the block, the block ends early with
 * this week as its deload, which moves the calendar for every modality.
 */
function blockFor(
  input: WeekPlanInput,
  config: EngineConfig,
  lift: LiftEngineState,
): { id: string; position: BlockPosition; row: UpsertData<"block"> | null } {
  const containing = input.blocks
    .filter((b) => {
      const days = daysBetween(b.startDate, input.weekStart);
      return b.deletedAt === null && days >= 0 && days < b.weekCount * 7;
    })
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  if (containing) {
    const index = Math.floor(
      daysBetween(containing.startDate, input.weekStart) / 7,
    );
    const earlyDeload =
      index < containing.weekCount - 1 &&
      stalledMainLifts(
        lift,
        input.exercises,
        containing.startDate,
        input.weekStart,
      ) >= config.lift.block.earlyDeloadStalls;
    const weekCount = earlyDeload ? index + 1 : containing.weekCount;
    return {
      id: containing.id,
      position: {
        startDate: containing.startDate,
        index,
        weekCount,
        type: weekTypeAt(index, weekCount),
        earlyDeload,
      },
      row: earlyDeload
        ? {
            id: containing.id,
            createdAt: containing.createdAt,
            updatedAt: input.now,
            deletedAt: null,
            name: containing.name,
            startDate: containing.startDate,
            weekCount,
            engineVersion: PLAN_VERSION,
          }
        : null,
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
  return {
    id: created.id,
    position: {
      startDate: created.startDate,
      index: 0,
      weekCount: created.weekCount,
      type: weekTypeAt(0, created.weekCount),
      earlyDeload: false,
    },
    row: created,
  };
}

type PlannedSlot = {
  sets: number;
  rampSets: number;
  targetRir: number | null;
  reasons: Reason[];
};

/**
 * Every lift slot's sets and RIR for the week (§5.1 Block structure), keyed
 * `<session key>:<slot index>`, with ramp sets held to the weekly hard-set cap.
 */
function planSlots(
  input: WeekPlanInput,
  lift: LiftEngineState,
  position: BlockPosition,
  ctxFor: (date: string) => EngineContext,
  config: EngineConfig,
): Map<string, PlannedSlot> {
  const byId = new Map(input.exercises.map((e) => [e.id, e]));
  const keys: string[] = [];
  const schemes: ReturnType<typeof weekScheme>[] = [];
  const requests: RampRequest[] = [];
  for (const spec of DEFAULT_WEEK) {
    if (spec.modality !== "lift") continue;
    const template = templateFor(input, spec.template);
    if (!template) continue;
    const ctx = ctxFor(addDays(input.weekStart, spec.weekday - 1));
    const resolved = resolveSlots(
      template.slots,
      input.exercises,
      ctx.equipment,
    );
    template.slots.forEach((slot, i) => {
      const selected = resolved[i];
      const exercise = selected ? (byId.get(selected.id) ?? null) : null;
      const scheme = weekScheme(
        slot,
        exercise,
        exercise ? lift.exercises[exercise.id] : undefined,
        position,
        ctx,
      );
      keys.push(`${spec.key}:${i}`);
      schemes.push(scheme);
      requests.push({
        muscles: exercise?.primaryMuscles ?? [],
        sets: scheme.sets,
        rampSets: scheme.rampSets,
      });
    });
  }
  const cap = config.lift.block.hardSetCap;
  const granted = capRampSets(requests, cap);
  return new Map(
    keys.map((key, i) => {
      const scheme = schemes[i]!;
      const ramp = rampReason(scheme, granted[i]!, cap);
      return [
        key,
        {
          sets: scheme.sets + granted[i]!.rampSets,
          rampSets: granted[i]!.rampSets,
          targetRir: scheme.targetRir,
          reasons: ramp ? [...scheme.reasons, ramp] : scheme.reasons,
        },
      ];
    }),
  );
}

const templateFor = (input: WeekPlanInput, key: string) =>
  input.templates.find(
    (t) => t.id === defaultTemplateId(key) && t.deletedAt === null,
  );

/**
 * Plans a week (SPEC §3.2, §5.4): the block calendar position, then
 * {@link DEFAULT_WEEK}'s sessions with lift progression and the run/climb
 * engines, plus block, deload and layoff adjustments. Pure, and the same
 * inputs give the same ids, so the phone's provisional week and server line
 * up.
 */
export function planWeek(input: WeekPlanInput): WeekPlan {
  const config = input.config ?? ENGINE_CONFIG;
  const { now, weekStart, settings } = input;
  let liftState = initLiftEngineState(settings.onboarding, config.lift);
  for (const log of input.logs.lift) {
    liftState = updateLiftEngineState(liftState, log, config.lift);
  }
  const block = blockFor(input, config, liftState);
  const { position } = block;
  const type = position.type;
  const week: UpsertData<"week"> = {
    id: weekId(weekStart),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    blockId: block.id,
    index: position.index,
    startDate: weekStart,
    type,
    engineVersion: PLAN_VERSION,
  };

  let run = runStub.initState(settings.onboarding);
  for (const log of input.logs.run) run = runStub.update(run, log);
  let climb = climbStub.initState(settings.onboarding);
  for (const log of input.logs.climb) climb = climbStub.update(climb, log);

  const ctxFor = (date: string): EngineContext => ({
    date,
    weekType: type,
    readiness: "green",
    weightUnit: settings.weightUnit,
    distanceUnit: settings.distanceUnit,
    equipment: settings.equipment,
    config,
  });
  const slots = planSlots(input, liftState, position, ctxFor, config);
  const byId = new Map(input.exercises.map((e) => [e.id, e]));
  const liftDates = input.logs.lift
    .filter((l) => l.sets.some((s) => !s.isWarmup))
    .map((l) => l.session.localDate);

  const taken = new Set<string>();
  const sessions: UpsertData<"planned_session">[] = [];
  const items: UpsertData<"planned_item">[] = [];
  const decisions: EngineDecision[] = [];

  for (const spec of DEFAULT_WEEK) {
    const date = addDays(weekStart, spec.weekday - 1);
    const id = plannedSessionId(weekStart, spec.key);
    const ctx = ctxFor(date);
    const targets: {
      kind: PlannedItemKind;
      exerciseId: string | null;
      targets: Record<string, unknown>;
      reasons: Reason[];
      decision?: Omit<EngineDecision, "plannedItemId">;
    }[] = [];
    let workoutType: string;
    let intent: Intent;
    let templateId: string | null = null;
    let version: string;

    if (spec.modality === "lift") {
      const template = templateFor(input, spec.template);
      workoutType = spec.key;
      intent = template?.intent ?? "support";
      version = LIFT_ENGINE_VERSION;
      if (template) {
        templateId = template.id;
        const planned = template.slots.map((_, i) =>
          slots.get(`${spec.key}:${i}`),
        );
        const resolved = resolveSlots(
          template.slots,
          input.exercises,
          ctx.equipment,
        );
        const resolvedIds = new Set(
          resolved.flatMap((exercise) => (exercise ? [exercise.id] : [])),
        );
        const reentry = layoffReentry(liftDates, date, config.lift.layoff);
        liftDates.push(date);
        template.slots.forEach((slot, i) => {
          const selected = resolved[i];
          const exercise = selected ? (byId.get(selected.id) ?? null) : null;
          const plannedSlot = planned[i];
          const scheme: SlotScheme = {
            sets: plannedSlot?.sets ?? slot.sets,
            repMin: slot.repMin,
            repMax: slot.repMax,
            targetRir: plannedSlot?.targetRir ?? slot.targetRir,
          };
          const state = exercise
            ? (liftState.exercises[exercise.id] ?? null)
            : null;
          const candidates: ProgressionExercise[] = exercise?.substitutionGroup
            ? input.exercises.filter(
                (candidate) =>
                  candidate.substitutionGroup === exercise.substitutionGroup &&
                  !resolvedIds.has(candidate.id),
              )
            : [];
          let progression = exercise
            ? progressExercise(
                state ?? undefined,
                exercise,
                scheme,
                ctx,
                candidates,
              )
            : null;
          let itemExercise = exercise;
          let progressionReasons = progression?.reasons ?? [];
          if (progression?.swapTo) {
            const swap = byId.get(progression.swapTo);
            if (swap) {
              const variation = progressExercise(
                liftState.exercises[swap.id],
                swap,
                scheme,
                ctx,
              );
              progressionReasons = [
                ...progression.reasons.filter(
                  (reason) => reason.code === "plateau_variation",
                ),
                ...variation.reasons,
              ];
              progression = variation;
              itemExercise = swap;
            }
          }
          const exerciseId = itemExercise?.id ?? null;
          let load = progression?.load ?? null;
          const extra: Reason[] = [];
          if (load && type === "deload") {
            const share = config.lift.block.deloadLoad;
            load = scaleLoad(
              weekOneLoad(
                itemExercise === null
                  ? undefined
                  : liftState.exercises[itemExercise.id],
                position.startDate,
              ) ?? load,
              share,
              itemExercise,
              ctx,
            );
            extra.push({
              code: "deload_load",
              text: `${describeLoad(load)}, about ${Math.round(share * 100)}% of week 1's weight.`,
            });
          }
          if (load && reentry) {
            load = scaleLoad(load, 1 - reentry.cut, itemExercise, ctx);
            extra.push(reentry.reason);
          }
          const targetValues = {
            load,
            band: progression?.band ?? null,
            sets: progression?.sets ?? scheme.sets,
            repMin: progression?.repMin ?? scheme.repMin,
            repMax: progression?.repMax ?? scheme.repMax,
            targetRir: progression?.targetRir ?? scheme.targetRir,
            restSec: slot.restSec,
            ramp: slot.ramp,
            ...(slot.ramp ? { rampSets: plannedSlot?.rampSets ?? 0 } : {}),
            ...(progression?.backOff ? { backOff: progression.backOff } : {}),
          };
          const reasons = [
            ...slotReasons(slot, exercise, input.exercises),
            ...progressionReasons,
            ...(plannedSlot?.reasons ?? []),
            ...extra,
          ];
          targets.push({
            kind: "exercise",
            exerciseId,
            targets: targetValues,
            reasons,
            decision: {
              engineVersion: LIFT_ENGINE_VERSION,
              inputs: {
                date,
                weekType: type,
                blockIndex: position.index,
                slot,
                scheme,
                exerciseId: exercise?.id ?? null,
                state,
                layoffCut: reentry?.cut ?? null,
              },
              rules: reasons.map((reason) => reason.code),
              outputs: {
                exerciseId,
                targets: targetValues,
                reasons: reasons.map((reason) => reason.text),
              },
            },
          });
        });
      }
    } else if (spec.modality === "run") {
      const runType: RunWorkoutType =
        spec.workoutType === "quality"
          ? position.index % 2 === 0
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
    targets.forEach((t, position) => {
      const plannedId = plannedItemId(id, position);
      items.push({
        id: plannedId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        plannedSessionId: id,
        position,
        kind: t.kind,
        exerciseId: t.exerciseId,
        targets: t.targets,
        reasons: t.reasons.map((r) => r.text),
      });
      if (t.decision) {
        decisions.push({ ...t.decision, plannedItemId: plannedId });
      }
    });
  }

  return { block: block.row, week, sessions, items, decisions };
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
