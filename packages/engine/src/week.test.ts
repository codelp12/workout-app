import {
  DEFAULT_AVAILABILITY,
  DEFAULT_EQUIPMENT,
  addDays,
  defaultTemplateId,
  isoWeekday,
  weekId,
  type Template,
} from "@workout-app/shared";
import { describe, expect, it } from "vitest";
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
            primaryMuscles: [],
          },
          {
            id: dumbbellId,
            name: "Dumbbell squat",
            equipment: ["dumbbell"],
            substitutionGroup: "squat_quads",
            progressionModel: "e1rm_rir",
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
      load: { value: 50, unit: "lb" },
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
    { sets = 3, load = 50 } = {},
  ): LiftSessionLog => ({
    session: { localDate: date },
    sets: Array.from({ length: sets }, (_, index) => ({
      exerciseId: slotId(key, 0),
      index,
      loadValue: load,
      loadUnit: "lb" as const,
      band: null,
      reps,
      rir: 2,
      isWarmup: false,
    })),
    targets: {
      [slotId(key, 0)]: {
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
