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
import type { LiftExercise } from "./stubs/lift.js";
import {
  DEFAULT_WEEK,
  groupLogs,
  planWeek,
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
const exercises: LiftExercise[] = [
  ...new Set(templates.flatMap((t) => t.slots.map((s) => s.exerciseId!))),
].map((id) => ({
  id,
  name: id,
  equipment: ["dumbbell"],
  substitutionGroup: null,
}));

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
          deletedAt: null,
        },
        { id: "s2", modality: "run", localDate: "2026-10-28", deletedAt: null },
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

  it("has one spec per key", () => {
    expect(new Set(DEFAULT_WEEK.map((s) => s.key)).size).toBe(
      DEFAULT_WEEK.length,
    );
  });
});
