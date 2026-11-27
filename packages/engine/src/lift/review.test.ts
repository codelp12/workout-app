import { addDays, type Onboarding } from "@workout-app/shared";
import { describe, expect, it } from "vitest";
import { ENGINE_CONFIG } from "../config.js";
import type { LiftSessionLog } from "../stubs/lift.js";
import { reviewLiftWeek, type LiftReviewInput } from "./review.js";

const weekStart = "2026-03-09";
const lastMonday = addDays(weekStart, -7);
const config = ENGINE_CONFIG.lift;

const exercise = (id: string, name: string, primaryMuscles: string[] = []) => ({
  id,
  name,
  primaryMuscles,
});

const set = (
  exerciseId: string,
  fields: {
    loadValue?: number | null;
    loadUnit?: "lb" | "kg" | null;
    band?: string | null;
    reps: number;
    warmup?: boolean;
    index?: number;
  },
) => ({
  exerciseId,
  index: fields.index ?? 0,
  loadValue: fields.loadValue ?? null,
  loadUnit: fields.loadUnit ?? null,
  band: fields.band ?? null,
  reps: fields.reps,
  rir: 2,
  isWarmup: fields.warmup ?? false,
});

const log = (date: string, ...sets: LiftSessionLog["sets"][number][]) => ({
  session: { localDate: date },
  sets,
});

const input = (fields: Partial<LiftReviewInput> = {}): LiftReviewInput => ({
  weekStart,
  onboarding: null,
  logs: [],
  exercises: [],
  planned: [],
  config,
  ...fields,
});

describe("reviewLiftWeek", () => {
  it("chooses the top loaded set across units and most reps for bodyweight", () => {
    const weighted = exercise("weighted", "Weighted lift");
    const bodyweight = exercise("bodyweight", "Bodyweight lift");
    const review = reviewLiftWeek(
      input({
        exercises: [weighted, bodyweight],
        logs: [
          log(
            lastMonday,
            set("weighted", { loadValue: 130, loadUnit: "lb", reps: 10 }),
            set("weighted", { loadValue: 60, loadUnit: "kg", reps: 7 }),
            set("weighted", { loadValue: 60, loadUnit: "kg", reps: 8 }),
            set("bodyweight", { reps: 12 }),
            set("bodyweight", { band: "Blue", reps: 15 }),
          ),
        ],
      }),
    );

    expect(review.exercises).toMatchObject([
      {
        exerciseId: "bodyweight",
        topSet: { load: null, band: "Blue", reps: 15 },
      },
      {
        exerciseId: "weighted",
        topSet: { load: { value: 60, unit: "kg" }, band: null, reps: 8 },
      },
    ]);
  });

  it("excludes warm-ups and sets outside last week from the totals", () => {
    const lift = exercise("lift", "Lift");
    const thisWeek = addDays(weekStart, 1);
    const review = reviewLiftWeek(
      input({
        exercises: [lift],
        logs: [
          log(
            addDays(lastMonday, -1),
            set("lift", { loadValue: 100, loadUnit: "lb", reps: 12 }),
          ),
          log(
            lastMonday,
            set("lift", {
              loadValue: 80,
              loadUnit: "lb",
              reps: 10,
              warmup: true,
            }),
            set("lift", { loadValue: 100, loadUnit: "lb", reps: 8 }),
            set("lift", { loadValue: 100, loadUnit: "lb", reps: 8 }),
          ),
          log(
            thisWeek,
            set("lift", { loadValue: 150, loadUnit: "lb", reps: 20 }),
          ),
        ],
      }),
    );

    expect(review.exercises[0]).toMatchObject({
      topSet: { load: { value: 100, unit: "lb" }, reps: 8 },
      workingSets: 2,
      totalReps: 16,
    });
  });

  it("reports e1RM change and nulls when estimates are unavailable", () => {
    const trained = exercise("trained", "Trained");
    const newLoaded = exercise("new-loaded", "New loaded");
    const unweighted = exercise("unweighted", "Unweighted");
    const onboarding: Onboarding = {
      completedAt: 0,
      lifts: [
        {
          exerciseId: "trained",
          load: { value: 100, unit: "lb" },
          reps: 8,
          rir: 2,
        },
      ],
      run: null,
      climb: null,
    };
    const review = reviewLiftWeek(
      input({
        onboarding,
        exercises: [trained, newLoaded, unweighted],
        logs: [
          log(
            addDays(lastMonday, -1),
            set("trained", { loadValue: 125, loadUnit: "lb", reps: 8 }),
          ),
          log(
            lastMonday,
            set("trained", { loadValue: 135, loadUnit: "lb", reps: 8 }),
            set("new-loaded", { loadValue: 90, loadUnit: "lb", reps: 8 }),
            set("unweighted", { reps: 20 }),
          ),
        ],
      }),
    );
    const byId = new Map(
      review.exercises.map((exercise) => [exercise.exerciseId, exercise]),
    );
    const trainedReview = byId.get("trained")!;
    const newReview = byId.get("new-loaded")!;
    const unweightedReview = byId.get("unweighted")!;

    expect(trainedReview.e1rmBefore?.unit).toBe("lb");
    expect(trainedReview.e1rmBefore?.value).toBeGreaterThan(
      100 * (1 + 10 / 30),
    );
    expect(trainedReview.e1rmAfter?.value).toBeGreaterThan(
      trainedReview.e1rmBefore!.value,
    );
    expect(trainedReview.e1rmChange).toMatchObject({ unit: "lb" });
    expect(trainedReview.e1rmChange?.value).toBeCloseTo(
      trainedReview.e1rmAfter!.value - trainedReview.e1rmBefore!.value,
    );
    expect(newReview).toMatchObject({
      e1rmBefore: null,
      e1rmAfter: { unit: "lb" },
      e1rmChange: null,
    });
    expect(unweightedReview).toMatchObject({
      e1rmBefore: null,
      e1rmAfter: null,
      e1rmChange: null,
    });
  });

  it("counts working sets for every primary muscle and selects the earliest plan", () => {
    const chestPress = exercise("press", "Press", ["chest", "triceps"]);
    const plank = exercise("plank", "Plank", ["abs"]);
    const firstTargets = { sets: 3, repMin: 8, repMax: 10 };
    const laterTargets = { sets: 4, repMin: 6, repMax: 8 };
    const review = reviewLiftWeek(
      input({
        exercises: [chestPress, plank],
        logs: [
          log(
            lastMonday,
            set("press", { loadValue: 100, loadUnit: "lb", reps: 8 }),
            set("press", { loadValue: 100, loadUnit: "lb", reps: 8 }),
            set("press", { loadValue: 100, loadUnit: "lb", reps: 8 }),
            set("plank", { reps: 30 }),
          ),
        ],
        planned: [
          {
            date: addDays(weekStart, 2),
            exerciseId: "press",
            targets: laterTargets,
            reasons: ["Later plan."],
          },
          {
            date: weekStart,
            exerciseId: "press",
            targets: firstTargets,
            reasons: ["First plan."],
          },
        ],
      }),
    );

    expect(review.muscles).toEqual([
      { muscle: "chest", hardSets: 3, cap: config.block.hardSetCap },
      { muscle: "triceps", hardSets: 3, cap: config.block.hardSetCap },
      { muscle: "abs", hardSets: 1, cap: config.block.hardSetCap },
    ]);
    expect(
      review.exercises.find((e) => e.exerciseId === "press")?.thisWeek,
    ).toEqual({ targets: firstTargets, reasons: ["First plan."] });
    expect(
      review.exercises.find((e) => e.exerciseId === "plank")?.thisWeek,
    ).toBe(null);
  });
});
