import {
  DEFAULT_AVAILABILITY,
  DEFAULT_EQUIPMENT,
  addDays,
  defaultTemplateId,
  isoWeekday,
  weekId,
  type Onboarding,
  type Template,
} from "@workout-app/shared";
import { describe, expect, it } from "vitest";
import { ENGINE_CONFIG } from "./config.js";
import { LIFT_ENGINE_VERSION } from "./lift/state.js";
import type { LiftSessionLog } from "./stubs/lift.js";
import {
  DEFAULT_WEEK,
  groupLogs,
  PLAN_VERSION,
  planWeek,
  type PlanExercise,
  type WeekPlan,
  type WeekPlanInput,
} from "./week.js";

const MONDAY = "2026-11-02";
const now = () =>
  (
    globalThis as typeof globalThis & {
      performance: { now: () => number };
    }
  ).performance.now();

const TEMPLATE_NAMES = {
  push_a: "Push A",
  push_b: "Push B",
  pull_a: "Pull A",
  pull_b: "Pull B",
  legs_a: "Legs A",
  legs_b: "Legs B",
};
const templates: Template[] = Object.entries(TEMPLATE_NAMES).map(
  ([key, name]) => ({
    id: defaultTemplateId(key),
    userId: 1,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    serverSeq: 1,
    name,
    modality: "lift",
    intensityClass: key.endsWith("_a") ? "heavy" : "moderate",
    intent: key === "legs_a" ? "key" : "support",
    slots: [0, 1, 2, 3, 4, 5].map((i) => ({
      exerciseId: weekId(`${key}-${i}`),
      substitutionGroup: null,
      sets: 3,
      repMin: 8,
      repMax: 12,
      targetRir: 2,
      restSec: 90,
      ramp: i < 2,
    })),
  }),
);
const slotId = (key: string, i: number) => weekId(`${key}-${i}`);
const exercises: PlanExercise[] = Object.keys(TEMPLATE_NAMES).flatMap((key) =>
  [0, 1, 2, 3, 4, 5].map((i) => ({
    id: slotId(key, i),
    name: `${key}-${i}`,
    equipment: ["dumbbell"],
    substitutionGroup: null,
    progressionModel: i === 0 ? "e1rm_rir" : null,
    increment: null,
    primaryMuscles: [],
  })),
);

const input = (fields: Partial<WeekPlanInput> = {}): WeekPlanInput => ({
  weekStart: MONDAY,
  now: 1000,
  blocks: [],
  settings: {
    weightUnit: "lb",
    distanceUnit: "mi",
    equipment: DEFAULT_EQUIPMENT,
    availability: DEFAULT_AVAILABILITY,
    onboarding: null,
  },
  templates,
  exercises,
  logs: { lift: [], run: [], climb: [] },
  ...fields,
});

describe("planWeek", () => {
  const plan = planWeek(input());

  it("plans the 11 sessions inside the hard constraints", () => {
    expect(plan.sessions).toHaveLength(11);
    const counts = (modality: string) =>
      plan.sessions.filter((s) => s.modality === modality).length;
    expect([counts("lift"), counts("run"), counts("climb")]).toEqual([6, 3, 2]);
    for (let day = 0; day < 7; day++) {
      const date = addDays(MONDAY, day);
      const today = plan.sessions.filter((s) => s.date === date);
      expect(today.length).toBeLessThanOrEqual(2);
      expect(new Set(today.map((s) => s.modality)).size).toBe(today.length);
      expect(new Set(today.map((s) => s.slot)).size).toBe(today.length);
    }
    expect(plan.sessions.map((s) => isoWeekday(s.date))).not.toContain(4);
  });

  it("starts a block and gives every item targets and a reason", () => {
    expect(plan.block).toMatchObject({ startDate: MONDAY, weekCount: 4 });
    expect(plan.week).toMatchObject({
      id: weekId(MONDAY),
      blockId: plan.block!.id,
      index: 0,
      type: "loading",
    });
    const lifts = plan.sessions.filter((s) => s.modality === "lift");
    expect(lifts.every((s) => s.templateId !== null)).toBe(true);
    expect(lifts.find((s) => s.workoutType === "legs_a")?.intent).toBe("key");
    // One item per template slot, plus one per run and climb.
    expect(plan.items).toHaveLength(36 + 5);
    for (const item of plan.items)
      expect(item.reasons.length).toBeGreaterThan(0);
    const ids = new Set(plan.sessions.map((s) => s.id));
    expect(plan.items.every((i) => ids.has(i.plannedSessionId))).toBe(true);
  });

  it("records one versioned decision for every lift item", () => {
    const liftSessionIds = new Set(
      plan.sessions
        .filter((session) => session.modality === "lift")
        .map((s) => s.id),
    );
    const liftItems = plan.items.filter((item) =>
      liftSessionIds.has(item.plannedSessionId),
    );
    expect(plan.decisions).toHaveLength(liftItems.length);
    expect(
      plan.decisions.map((decision) => decision.plannedItemId).sort(),
    ).toEqual(liftItems.map((item) => item.id).sort());
    for (const decision of plan.decisions) {
      const item = liftItems.find(
        (candidate) => candidate.id === decision.plannedItemId,
      )!;
      expect(decision.engineVersion).toBe(LIFT_ENGINE_VERSION);
      expect(decision.outputs.reasons).toEqual(item.reasons);
      expect(decision.rules).toHaveLength(item.reasons.length);
    }
    const firstPush = plan.sessions.find(
      (session) => session.workoutType === "push_a",
    )!;
    const mainItem = liftItems.find(
      (item) => item.plannedSessionId === firstPush.id && item.position === 0,
    )!;
    expect(
      plan.decisions.find((decision) => decision.plannedItemId === mainItem.id)!
        .rules,
    ).toEqual(["no_history", "block_rir"]);
    expect(
      plan.decisions.every((decision) =>
        liftSessionIds.has(
          plan.items.find((item) => item.id === decision.plannedItemId)!
            .plannedSessionId,
        ),
      ),
    ).toBe(true);
  });

  it("plans an equipment-first substitute named in the template slot", () => {
    const barbellId = weekId("barbell-squat");
    const dumbbellId = weekId("dumbbell-squat");
    const pushA = templates.find((template) => template.name === "Push A")!;
    const next = planWeek(
      input({
        templates: templates.map((template) =>
          template === pushA
            ? {
                ...template,
                slots: [
                  { ...template.slots[0]!, exerciseId: barbellId },
                  ...template.slots.slice(1),
                ],
              }
            : template,
        ),
        exercises: [
          ...exercises,
          {
            id: barbellId,
            name: "Barbell squat",
            equipment: ["barbell"],
            substitutionGroup: "squat_quads",
            progressionModel: "e1rm_rir",
            increment: null,
            primaryMuscles: [],
          },
          {
            id: dumbbellId,
            name: "Dumbbell squat",
            equipment: ["dumbbell"],
            substitutionGroup: "squat_quads",
            progressionModel: "e1rm_rir",
            increment: null,
            primaryMuscles: [],
          },
        ],
      }),
    );
    const item = next.items.find(
      (planned) => planned.exerciseId === dumbbellId,
    );
    expect(item?.reasons).toContain(
      'Dumbbell squat replaces Barbell squat so you can use your dumbbells. Turn on "Keep this exercise" in the template to keep Barbell squat.',
    );
  });

  it("keeps a barbell slot when its dumbbell substitute is already in the workout", () => {
    const barbellId = weekId("barbell-squat");
    const dumbbellId = weekId("dumbbell-squat");
    const pushA = templates.find((template) => template.name === "Push A")!;
    const next = planWeek(
      input({
        templates: templates.map((template) =>
          template === pushA
            ? {
                ...template,
                slots: [
                  { ...template.slots[0]!, exerciseId: dumbbellId },
                  { ...template.slots[0]!, exerciseId: barbellId },
                  ...template.slots.slice(1),
                ],
              }
            : template,
        ),
        exercises: [
          ...exercises,
          {
            id: barbellId,
            name: "Barbell squat",
            equipment: ["barbell"],
            substitutionGroup: "squat_quads",
            progressionModel: "e1rm_rir",
            increment: null,
            primaryMuscles: [],
          },
          {
            id: dumbbellId,
            name: "Dumbbell squat",
            equipment: ["dumbbell"],
            substitutionGroup: "squat_quads",
            progressionModel: "e1rm_rir",
            increment: null,
            primaryMuscles: [],
          },
        ],
      }),
    );
    const dumbbellItem = next.items.find(
      (planned) => planned.exerciseId === dumbbellId,
    );
    const barbellItem = next.items.find(
      (planned) => planned.exerciseId === barbellId,
    );
    expect(dumbbellItem).toBeDefined();
    expect(barbellItem?.exerciseId).not.toBe(dumbbellItem?.exerciseId);
    expect(
      barbellItem?.reasons.some((reason) => reason.includes("replaces")),
    ).toBe(false);
  });

  it("is deterministic, including its ids", () => {
    expect(planWeek(input())).toEqual(plan);
  });

  it("walks the block to a deload, then starts the next block", () => {
    const blocks = [{ ...plan.block!, userId: 1, serverSeq: 1 }];
    const weeks = [1, 2, 3, 4].map((n) =>
      planWeek(input({ weekStart: addDays(MONDAY, 7 * n), blocks })),
    );
    expect(weeks.map((w) => [w.week.index, w.week.type, w.block])).toEqual([
      [1, "loading", null],
      [2, "loading", null],
      [3, "deload", null],
      [
        0,
        "loading",
        expect.objectContaining({ startDate: addDays(MONDAY, 28) }),
      ],
    ]);
    const quality = (p: typeof plan) =>
      p.sessions.find(
        (s) =>
          s.id.length &&
          s.modality === "run" &&
          s.intent === "key" &&
          isoWeekday(s.date) === 5,
      )?.workoutType;
    expect([plan, ...weeks.slice(0, 1)].map(quality)).toEqual([
      "threshold",
      "intervals",
    ]);
  });

  it("ignores a deleted block", () => {
    const blocks = [{ ...plan.block!, userId: 1, serverSeq: 1, deletedAt: 5 }];
    const next = planWeek(input({ weekStart: addDays(MONDAY, 7), blocks }));
    expect(next.block?.startDate).toBe(addDays(MONDAY, 7));
  });

  it("moves a session to the day's other slot when its own is unavailable", () => {
    const availability = DEFAULT_AVAILABILITY.map((d) =>
      d.weekday === 3 ? { ...d, pm: false } : d,
    );
    const moved = planWeek(
      input({ settings: { ...input().settings, availability } }),
    );
    expect(moved.sessions.find((s) => s.workoutType === "legs_a")?.slot).toBe(
      "am",
    );
  });

  it("plans lifts without items when their template is gone", () => {
    const pushA = templates.find((t) => t.name === "Push A")!;
    const without = planWeek(
      input({
        templates: templates.map((t) =>
          t === pushA ? { ...t, deletedAt: 1 } : t,
        ),
      }),
    );
    const session = without.sessions.find((s) => s.workoutType === "push_a")!;
    expect(session.templateId).toBeNull();
    expect(without.items.some((i) => i.plannedSessionId === session.id)).toBe(
      false,
    );
  });

  it("prefills from logs", () => {
    const [bench] = templates.find((t) => t.name === "Push A")!.slots;
    const logs = groupLogs({
      sessions: [
        {
          id: "s1",
          modality: "lift",
          localDate: "2026-10-27",
          startedAt: 0,
          deletedAt: null,
        },
        {
          id: "s2",
          modality: "run",
          localDate: "2026-10-28",
          startedAt: 0,
          deletedAt: null,
        },
      ],
      sets: [
        {
          sessionLogId: "s1",
          exerciseId: bench!.exerciseId!,
          index: 0,
          loadValue: 50,
          loadUnit: "lb",
          band: null,
          reps: 8,
          rir: 2,
          isWarmup: false,
          deletedAt: null,
        },
      ],
      runs: [
        {
          sessionLogId: "s2",
          workoutType: "easy",
          distanceValue: 3,
          distanceUnit: "mi",
          durationSec: 1800,
          deletedAt: null,
        },
        {
          sessionLogId: "s2",
          workoutType: "long",
          distanceValue: 9,
          distanceUnit: "mi",
          durationSec: 1800,
          deletedAt: 1,
        },
      ],
      ascents: [],
    });
    expect(logs.run).toHaveLength(1);
    const next = planWeek(input({ logs }));
    expect(
      next.items.find((i) => i.exerciseId === bench!.exerciseId)?.targets,
    ).toMatchObject({
      load: { value: 45, unit: "lb" },
    });
    const easy = next.sessions.find((s) => s.workoutType === "easy")!;
    expect(
      next.items.find((i) => i.plannedSessionId === easy.id)?.targets,
    ).toMatchObject({
      distance: { value: 3, unit: "mi" },
    });
  });

  it("orders same-day sessions by start time", () => {
    const session = (id: string, startedAt: number) => ({
      id,
      modality: "lift" as const,
      localDate: "2026-10-27",
      startedAt,
      deletedAt: null,
    });
    const set = (sessionLogId: string, loadValue: number) => ({
      sessionLogId,
      exerciseId: "e",
      index: 0,
      loadValue,
      loadUnit: "lb" as const,
      band: null,
      reps: 8,
      rir: 2,
      isWarmup: false,
      deletedAt: null,
    });
    const { lift } = groupLogs({
      sessions: [session("late", 2), session("early", 1)],
      sets: [set("late", 60), set("early", 50)],
      runs: [],
      ascents: [],
    });
    expect(lift.map((l) => l.sets[0]?.loadValue)).toEqual([50, 60]);
  });

  it("reads ramp-slot targets planned before ramp sets were recorded", () => {
    const targets = {
      sets: 3,
      repMin: 8,
      repMax: 12,
      targetRir: 2,
      load: null,
    };
    const { lift } = groupLogs({
      sessions: [
        {
          id: "s",
          modality: "lift",
          localDate: "2026-10-27",
          startedAt: 1,
          plannedSessionId: "p",
          deletedAt: null,
        },
      ],
      sets: [],
      runs: [],
      ascents: [],
      items: [
        {
          plannedSessionId: "p",
          exerciseId: "a",
          targets: { ...targets, ramp: true },
          deletedAt: null,
        },
        { plannedSessionId: "p", exerciseId: "b", targets, deletedAt: null },
      ],
    });
    expect(lift[0]?.targets?.a?.rampSets).toBe(0);
    expect(lift[0]?.targets?.b?.rampSets).toBeUndefined();
  });

  it("has one spec per key", () => {
    expect(new Set(DEFAULT_WEEK.map((s) => s.key)).size).toBe(
      DEFAULT_WEEK.length,
    );
  });
});

describe("block calendar", () => {
  const first = planWeek(input());
  const saved = (block: NonNullable<WeekPlan["block"]>) => ({
    ...block,
    userId: 1,
    serverSeq: 1,
  });
  const blocks = [saved(first.block!)];
  const weekAt = (n: number, fields: Partial<WeekPlanInput> = {}) =>
    planWeek(input({ weekStart: addDays(MONDAY, 7 * n), blocks, ...fields }));
  const item = (plan: WeekPlan, key: string, i = 0) =>
    plan.items.find((it) => it.exerciseId === slotId(key, i))!;
  const lifted = (
    date: string,
    key: string,
    reps: number,
    { sets = 3, load = 50, exerciseIndex = 0 } = {},
  ): LiftSessionLog => ({
    session: { localDate: date },
    sets: Array.from({ length: sets }, (_, index) => ({
      exerciseId: slotId(key, exerciseIndex),
      index,
      loadValue: load,
      loadUnit: "lb" as const,
      band: null,
      reps,
      rir: 2,
      isWarmup: false,
    })),
    targets: {
      [slotId(key, exerciseIndex)]: {
        load: { value: load, unit: "lb" },
        band: null,
        sets,
        repMin: 8,
        repMax: 12,
        targetRir: 2,
        rampSets: 0,
      },
    },
  });
  const logs = (...lift: LiftSessionLog[]) => ({ lift, run: [], climb: [] });
  const blockRow = (index: number) =>
    saved({
      ...first.block!,
      id: index === 0 ? first.block!.id : `block-${index}`,
      startDate: addDays(MONDAY, index * 28),
      weekCount: 4,
    });
  const blockRows = (count: number) =>
    Array.from({ length: count }, (_, index) => blockRow(index));
  const targeted = (
    date: string,
    exerciseIndex: number,
    load: number,
    repMax = 12,
    key = "push_a",
    reps = 10,
    sets = 3,
  ) => {
    const exerciseId = slotId(key, exerciseIndex);
    const log = lifted(date, key, reps, { load, exerciseIndex, sets });
    return {
      ...log,
      targets: {
        ...log.targets,
        [exerciseId]: { ...log.targets![exerciseId]!, repMax },
      },
    };
  };
  const blockLogs = (
    count: number,
    exerciseIndex = 1,
    loadAt: (block: number, week: number) => number = () => 65,
    repMaxAt: (block: number, week: number) => number = () => 12,
    key = "push_a",
    repsAt: (block: number, week: number) => number = () => 10,
  ) =>
    Array.from({ length: count }, (_, block) =>
      Array.from({ length: 3 }, (_, week) =>
        targeted(
          addDays(MONDAY, block * 28 + week * 7),
          exerciseIndex,
          loadAt(block, week),
          repMaxAt(block, week),
          key,
          repsAt(block, week),
        ),
      ),
    ).flat();
  const decisionFor = (plan: WeekPlan, exerciseIndex: number, key = "push_a") =>
    plan.decisions.find(
      (decision) => decision.inputs.exerciseId === slotId(key, exerciseIndex),
    )!;

  it("plans e1rm_rir lifts from onboarding e1RM", () => {
    const exerciseId = slotId("push_a", 0);
    const onboarding: Onboarding = {
      completedAt: Date.parse("2026-10-01T00:00:00Z"),
      lifts: [
        {
          exerciseId,
          load: { value: 100, unit: "lb" },
          reps: 8,
          rir: 2,
        },
      ],
      run: null,
      climb: null,
    };
    const plan = weekAt(0, {
      settings: { ...input().settings, onboarding },
    });
    const planned = item(plan, "push_a");
    expect(planned.targets.load).not.toBeNull();
    expect(planned.reasons.some((reason) => reason.includes("e1RM"))).toBe(
      true,
    );
  });

  it("does not plan heavier than a missed target", () => {
    const missed = lifted(MONDAY, "push_a", 5, { load: 50 });
    const plan = weekAt(1, { logs: logs(missed) });
    const plannedLoad = (item(plan, "push_a").targets.load as { value: number })
      .value;
    expect(plannedLoad).toBeLessThanOrEqual(50);
  });

  it("steps double progression up after reaching the top on every set", () => {
    const doubleProgressionExercises = exercises.map((exercise) =>
      exercise.id === slotId("push_a", 1)
        ? { ...exercise, progressionModel: "double_progression" as const }
        : exercise,
    );
    const plan = weekAt(1, {
      exercises: doubleProgressionExercises,
      logs: logs(
        lifted(addDays(MONDAY, 6), "push_a", 12, {
          exerciseIndex: 1,
          load: 20,
        }),
      ),
    });
    const planned = item(plan, "push_a", 1);
    expect((planned.targets.load as { value: number }).value).toBeGreaterThan(
      20,
    );
  });

  it("puts an active variation plateau into the plan", () => {
    const exerciseId = slotId("push_a", 0);
    const group = "plateau-test";
    const exercisesWithVariation = exercises.map((exercise) =>
      exercise.id === exerciseId
        ? { ...exercise, substitutionGroup: group }
        : exercise,
    );
    const variation: PlanExercise = {
      ...exercisesWithVariation.find((exercise) => exercise.id === exerciseId)!,
      id: weekId("plateau-variation"),
      name: "Plateau variation",
      progressionModel: "double_progression",
      increment: null,
    };
    const history = Array.from({ length: 18 }, (_, index) =>
      lifted(addDays(MONDAY, index - 18), "push_a", 5, { load: 50 }),
    );
    const plan = weekAt(0, {
      exercises: [...exercisesWithVariation, variation],
      logs: logs(...history),
    });
    const session = plan.sessions.find(
      (candidate) => candidate.workoutType === "push_a",
    )!;
    const planned = plan.items.find(
      (candidate) =>
        candidate.plannedSessionId === session.id && candidate.position === 0,
    )!;
    expect(planned.exerciseId).toBe(variation.id);
    expect(planned.reasons[0]).toContain(
      `${variation.name} in place of ${exercisesWithVariation.find((exercise) => exercise.id === exerciseId)!.name}`,
    );
  });

  it("starts the next block from e1RM after a logged deload", () => {
    const onboarding: Onboarding = {
      completedAt: Date.parse("2026-10-01T00:00:00Z"),
      lifts: [
        {
          exerciseId: slotId("push_a", 0),
          load: { value: 100, unit: "lb" },
          reps: 8,
          rir: 2,
        },
      ],
      run: null,
      climb: null,
    };
    const settings = { ...input().settings, onboarding };
    const firstLog = lifted(MONDAY, "push_a", 12, { load: 100 });
    const deloadDate = addDays(MONDAY, 21);
    const deload = planWeek(
      input({
        weekStart: deloadDate,
        blocks,
        settings,
        logs: logs(firstLog),
      }),
    );
    const deloadLoad = (
      item(deload, "push_a").targets.load as { value: number }
    ).value;
    const deloadLog = lifted(deloadDate, "push_a", 12, { load: deloadLoad });
    const next = planWeek(
      input({
        weekStart: addDays(MONDAY, 28),
        blocks,
        settings,
        logs: logs(firstLog, deloadLog),
      }),
    );
    const nextItem = item(next, "push_a");
    const nextLoad = (nextItem.targets.load as { value: number }).value;
    expect(nextLoad).toBeGreaterThan(deloadLoad);
    expect(nextItem.reasons.some((reason) => reason.includes("e1RM"))).toBe(
      true,
    );
  });

  it("plans a year's worth of lift history under the per-session budget", () => {
    const weekdays = [0, 1, 2, 4, 5, 6];
    const keys = Object.keys(TEMPLATE_NAMES);
    const history = Array.from({ length: 52 }, (_, week) =>
      keys.map((key, index) =>
        lifted(
          addDays(MONDAY, -7 * (52 - week) + (weekdays[index] ?? 0)),
          key,
          10,
          { load: 50 },
        ),
      ),
    ).flat();
    const start = now();
    const plan = planWeek(input({ logs: logs(...history) }));
    const duration = now() - start;
    const liftSessions = plan.sessions.filter(
      (session) => session.modality === "lift",
    );
    expect(duration / liftSessions.length).toBeLessThan(50);
  });

  it("writes blocks and weeks with the engine version", () => {
    expect(first.block?.engineVersion).toBe(PLAN_VERSION);
    expect(first.week.engineVersion).toBe(PLAN_VERSION);
  });

  it("steps main lifts' RIR across a block of any length, then restarts at 3", () => {
    for (const weekCount of [3, 4, 5, 6]) {
      const long = [saved({ ...first.block!, weekCount })];
      const plans = Array.from({ length: weekCount + 1 }, (_, n) =>
        weekAt(n, { blocks: long }),
      );
      expect(plans.map((p) => p.week.type)).toEqual([
        ...Array<string>(weekCount - 1).fill("loading"),
        "deload",
        "loading",
      ]);
      const rir = plans.map((p) => item(p, "push_a").targets.targetRir);
      const loading = {
        3: [3, 1],
        4: [3, 2, 1],
        5: [3, 2, 2, 1],
        6: [3, 2, 2, 1, 1],
      }[weekCount]!;
      expect(rir).toEqual([...loading, 3, 3]);
      expect(plans.map((p) => item(p, "push_a", 2).targets.targetRir)).toEqual([
        ...Array<number>(weekCount - 1).fill(2),
        3,
        2,
      ]);
    }
  });

  it("halves the sets and takes about 90% of week 1's load on the deload", () => {
    const deload = weekAt(3, {
      logs: logs(
        lifted(MONDAY, "push_a", 12, { load: 50 }),
        lifted(addDays(MONDAY, 8), "push_a", 12, { load: 55 }),
        lifted(addDays(MONDAY, 16), "push_a", 12, { load: 60 }),
      ),
    });
    const bench = item(deload, "push_a");
    expect(bench.targets).toMatchObject({
      sets: 2,
      targetRir: 3,
      load: { value: 45, unit: "lb" },
    });
    expect(bench.reasons).toContain("45 lb, about 90% of week 1's weight.");
    expect(item(deload, "push_a", 3).targets).toMatchObject({ sets: 2 });
  });

  it("adds a ramp set after met targets, within the hard-set cap", () => {
    const met = weekAt(1, { logs: logs(lifted(MONDAY, "push_a", 12)) });
    expect(item(met, "push_a").targets).toMatchObject({ sets: 4, rampSets: 1 });
    expect(item(met, "push_a").reasons).toContain(
      "Met last week's targets, so 4 sets this week.",
    );
    expect(item(met, "push_b").targets.sets).toBe(3);

    const missed = weekAt(1, { logs: logs(lifted(MONDAY, "push_a", 5)) });
    expect(item(missed, "push_a").targets.sets).toBe(3);

    const chest = exercises.map((e) =>
      e.name.startsWith("push") ? { ...e, primaryMuscles: ["chest"] } : e,
    );
    const capped = weekAt(1, {
      exercises: chest,
      logs: logs(lifted(MONDAY, "push_a", 12)),
    });
    expect(item(capped, "push_a").targets.sets).toBe(3);
    expect(item(capped, "push_a").reasons).toContain(
      "3 sets: chest is at its cap of 20 hard sets this week.",
    );
  });

  it("deloads early when two main lifts stall, moving the calendar", () => {
    const stall = (key: string, days: number[]) =>
      days.map((d) => lifted(addDays(MONDAY, d), key, 5));
    const early = weekAt(1, {
      logs: logs(...stall("push_a", [0, 3]), ...stall("legs_a", [2, 6])),
    });
    expect(early.week).toMatchObject({ index: 1, type: "deload" });
    expect(early.block).toMatchObject({
      id: first.block!.id,
      startDate: MONDAY,
      weekCount: 2,
      engineVersion: PLAN_VERSION,
    });
    expect(
      item(early, "push_a").reasons.some((r) => r.startsWith("Early deload")),
    ).toBe(true);
    const next = planWeek(
      input({ weekStart: addDays(MONDAY, 14), blocks: [saved(early.block!)] }),
    );
    expect(next.week.index).toBe(0);
    expect(next.block?.startDate).toBe(addDays(MONDAY, 14));

    const one = weekAt(1, { logs: logs(...stall("push_a", [0, 3])) });
    expect([one.week.type, one.block]).toEqual(["loading", null]);
  });

  it("counts a flat double-progression block as a stall in the next block", () => {
    const plan = planWeek(
      input({
        weekStart: addDays(MONDAY, 28),
        blocks: blockRows(2),
        logs: logs(
          ...blockLogs(1),
          lifted(addDays(MONDAY, 27), "push_a", 10, {
            sets: 2,
            load: 65,
            exerciseIndex: 1,
          }),
        ),
      }),
    );
    const decision = decisionFor(plan, 1);
    expect(plan.week.type).toBe("loading");
    expect(decision.inputs.state).toMatchObject({
      lastOutcome: "stalled",
      lastStallDate: addDays(MONDAY, 14),
      stallCount: 1,
      blockStall: { status: "counted", progressionOutcome: "done" },
    });
    expect(decision.rules[0]).toBe("block_stall");
    expect(decision.rules).not.toContain("cut_after_stall");
    expect(decision.outputs.targets.load).toEqual({ value: 65, unit: "lb" });
    expect(decision.outputs.reasons[0]).toBe(
      "No weight or rep increase all block, so this counts as a stall.",
    );
    expect(
      decision.outputs.reasons.some((reason) =>
        reason.includes("Second miss in a row"),
      ),
    ).toBe(false);
  });

  it.each([
    ["done", 10, 65],
    ["top", 12, 70],
  ] as const)(
    "uses the latest loading target after a deload when outcome is %s",
    (outcome, reps, expectedLoad) => {
      const exerciseId = slotId("push_a", 1);
      const exercisesWithIncrement = exercises.map((exercise) =>
        exercise.id === exerciseId
          ? { ...exercise, increment: { value: 5, unit: "lb" as const } }
          : exercise,
      );
      const deload = targeted(
        addDays(MONDAY, 21),
        1,
        60,
        12,
        "push_a",
        10,
        2,
      );
      const plan = planWeek(
        input({
          weekStart: addDays(MONDAY, 28),
          blocks: blockRows(2),
          exercises: exercisesWithIncrement,
          logs: logs(
            ...blockLogs(1, 1, () => 65, () => 12, "push_a", () => reps),
            deload,
          ),
        }),
      );
      const decision = decisionFor(plan, 1);
      expect(decision.inputs.state).toMatchObject({
        blockStall: { status: "counted", progressionOutcome: outcome },
      });
      expect(decision.outputs.targets.load).toEqual({
        value: expectedLoad,
        unit: "lb",
      });
    },
  );

  it("starts the plateau handler after three flat double-progression blocks", () => {
    const startedOn = addDays(MONDAY, 84);
    const logsThroughPlateauStart = logs(
      ...blockLogs(3),
      targeted(startedOn, 1, 65),
    );
    const plan = planWeek(
      input({
        weekStart: startedOn,
        blocks: blockRows(4),
        logs: logsThroughPlateauStart,
      }),
    );
    expect(decisionFor(plan, 1).inputs.state).toMatchObject({
      stallCount: 0,
      plateaus: 1,
      plateau: { action: "rep_scheme", startedOn },
    });
    const active = planWeek(
      input({
        weekStart: addDays(
          startedOn,
          ENGINE_CONFIG.lift.progression.plateauDays - 7,
        ),
        blocks: blockRows(4),
        logs: logsThroughPlateauStart,
      }),
    );
    expect(decisionFor(active, 1).rules).toContain("plateau_rep_scheme");
    const expired = planWeek(
      input({
        weekStart: addDays(
          startedOn,
          ENGINE_CONFIG.lift.progression.plateauDays,
        ),
        blocks: blockRows(5),
        logs: logsThroughPlateauStart,
      }),
    );
    expect(decisionFor(expired, 1).rules).not.toContain("plateau_rep_scheme");
  });

  it("does not count a block with a heavier target load as stalled", () => {
    const plan = planWeek(
      input({
        weekStart: addDays(MONDAY, 28),
        blocks: blockRows(2),
        logs: logs(
          ...blockLogs(1, 1, (_block, week) => (week === 0 ? 65 : 70)),
        ),
      }),
    );
    expect(decisionFor(plan, 1).rules).not.toContain("block_stall");
    expect(decisionFor(plan, 1).inputs.state).toMatchObject({
      lastOutcome: "done",
      stallCount: 0,
    });
  });

  it("counts a repMax extension as progress within a block", () => {
    const plan = planWeek(
      input({
        weekStart: addDays(MONDAY, 28),
        blocks: blockRows(2),
        logs: logs(
          ...blockLogs(
            1,
            1,
            () => 65,
            (_block, week) => (week === 0 ? 12 : 13),
          ),
        ),
      }),
    );
    expect(decisionFor(plan, 1).rules).not.toContain("block_stall");
    expect(decisionFor(plan, 1).inputs.state).toMatchObject({
      lastOutcome: "done",
      stallCount: 0,
    });
  });

  it("never block-stalls e1rm_rir lifts", () => {
    const plan = planWeek(
      input({
        weekStart: addDays(MONDAY, 28),
        blocks: blockRows(2),
        logs: logs(...blockLogs(1, 0)),
      }),
    );
    expect(decisionFor(plan, 0).rules).not.toContain("block_stall");
    expect(decisionFor(plan, 0).inputs.state).toMatchObject({
      lastOutcome: "done",
      stallCount: 0,
      blockStall: null,
    });
  });

  it("does not early-deload after two double-progression main lifts stall", () => {
    const mainIds = new Set([slotId("push_a", 0), slotId("legs_a", 0)]);
    const mainExercises = exercises.map((exercise) =>
      mainIds.has(exercise.id)
        ? {
            ...exercise,
            progressionModel: "double_progression" as const,
            increment: { value: 5, unit: "lb" as const },
          }
        : exercise,
    );
    const logsThroughFirstNextWeek = (key: string) => [
      ...blockLogs(
        1,
        0,
        () => 65,
        () => 12,
        key,
      ),
      targeted(addDays(MONDAY, 28), 0, 65, 12, key),
    ];
    const plan = planWeek(
      input({
        weekStart: addDays(MONDAY, 42),
        blocks: blockRows(2),
        exercises: mainExercises,
        logs: logs(
          ...logsThroughFirstNextWeek("push_a"),
          ...logsThroughFirstNextWeek("legs_a"),
        ),
      }),
    );
    expect(plan.week).toMatchObject({ index: 2, type: "loading" });
    expect(plan.block).toBeNull();
    expect(
      plan.items.some((planned) =>
        planned.reasons.some((reason) => reason.startsWith("Early deload")),
      ),
    ).toBe(false);
    for (const key of ["push_a", "legs_a"]) {
      expect(decisionFor(plan, 0, key).inputs.state).toMatchObject({
        lastStallDate: addDays(MONDAY, 14),
        stallCount: 1,
      });
    }
  });

  it("lightens the first session back after a layoff", () => {
    const after = (days: number) =>
      planWeek(
        input({
          logs: logs(
            lifted(addDays(MONDAY, -days), "push_a", 10),
            lifted(addDays(MONDAY, -days), "legs_b", 10),
          ),
        }),
      );
    const loads = (plan: WeekPlan) =>
      ["push_a", "legs_b"].map(
        (key) => (item(plan, key).targets.load as { value: number }).value,
      );
    expect(loads(after(6))).toEqual([50, 50]);
    expect(loads(after(7))).toEqual([45, 50]);
    expect(loads(after(13))).toEqual([45, 50]);
    expect(loads(after(14))).toEqual([40, 40]);
    expect(loads(after(20))).toEqual([40, 40]);
    expect(item(after(20), "legs_b").reasons).toContain(
      "First week back since 2026-11-02: 17.5% lighter.",
    );
  });
});
