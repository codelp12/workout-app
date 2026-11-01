import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { exerciseSchema } from "@workout-app/shared";
import { describe, expect, it } from "vitest";
import {
  FREE_EXERCISE_DB,
  FREE_EXERCISE_DB_SOURCE,
  freeExerciseDbFile,
  loadFreeExerciseDb,
  loadRawFreeExerciseDb,
  mapExercise,
  type ExerciseData,
  type RawExercise,
} from "./index.js";

const provenance = { source: "free-exercise-db@abc", license: "Unlicense" };

function raw(overrides: Partial<RawExercise> = {}): RawExercise {
  return {
    id: "Test_Exercise",
    name: "Test Exercise",
    force: "push",
    level: "beginner",
    mechanic: "compound",
    equipment: "dumbbell",
    primaryMuscles: ["chest"],
    secondaryMuscles: ["triceps", "shoulders"],
    instructions: ["Do it."],
    category: "strength",
    images: ["Test_Exercise/0.jpg", "Test_Exercise/1.jpg"],
    ...overrides,
  };
}

function map(overrides: Partial<RawExercise> = {}): ExerciseData {
  const mapped = mapExercise(raw(overrides), provenance);
  if (!mapped) throw new Error("expected the exercise to be imported");
  return mapped;
}

describe("mapExercise", () => {
  it("copies the dataset fields and stamps source and license", () => {
    expect(map({ name: "Dumbbell Bench Press" })).toEqual({
      name: "Dumbbell Bench Press",
      aliases: ["DB Bench Press"],
      modality: "lift",
      movementPattern: "horizontal_push",
      primaryMuscles: ["chest"],
      secondaryMuscles: ["triceps", "shoulders"],
      equipment: ["dumbbell"],
      mechanic: "compound",
      unilateral: false,
      progressionModel: "e1rm_rir",
      increment: null,
      repMin: null,
      repMax: null,
      stressTags: ["shoulder", "elbow", "wrist"],
      substitutionGroup: "horizontal_push:chest",
      instructions: ["Do it."],
      cues: [],
      commonMistakes: [],
      media: [
        { kind: "image", path: "Test_Exercise/0.webp", ...provenance },
        { kind: "image", path: "Test_Exercise/1.webp", ...provenance },
      ],
      source: provenance.source,
      license: provenance.license,
      sourceId: "Test_Exercise",
    });
  });

  it("skips cardio, which is logged as runs", () => {
    expect(
      mapExercise(
        raw({ category: "cardio", name: "Running, Treadmill" }),
        provenance,
      ),
    ).toBeNull();
  });

  it("imports stretches as mobility with no progression", () => {
    const stretch = map({
      category: "stretching",
      name: "Hamstring Stretch",
      primaryMuscles: ["hamstrings"],
      mechanic: null,
    });
    expect(stretch).toMatchObject({
      modality: "mobility",
      movementPattern: "stretch",
      progressionModel: null,
      repMin: null,
      repMax: null,
      substitutionGroup: "stretch:hamstrings",
      stressTags: ["hip"],
    });
  });

  it("maps equipment and muscle names to snake_case", () => {
    expect(map({ equipment: "body only" }).equipment).toEqual(["bodyweight"]);
    expect(map({ equipment: "e-z curl bar" }).equipment).toEqual(["ez_bar"]);
    expect(map({ equipment: null }).equipment).toEqual([]);
    expect(
      map({
        primaryMuscles: ["lower back"],
        secondaryMuscles: ["middle back"],
      }),
    ).toMatchObject({
      primaryMuscles: ["lower_back"],
      secondaryMuscles: ["middle_back"],
    });
  });

  it.each([
    ["Goblet Squat", ["quadriceps"], "squat"],
    ["Leg Press", ["quadriceps"], "squat"],
    ["Dumbbell Step Ups", ["quadriceps"], "lunge"],
    ["Barbell Walking Lunge", ["quadriceps"], "lunge"],
    ["Romanian Deadlift", ["hamstrings"], "hinge"],
    ["Barbell Hip Thrust", ["glutes"], "hinge"],
    ["Seated Dumbbell Press", ["shoulders"], "vertical_push"],
    ["Pushups", ["chest"], "horizontal_push"],
    ["One-Arm Dumbbell Row", ["middle back"], "horizontal_pull"],
    ["Face Pull", ["shoulders"], "horizontal_pull"],
    ["Weighted Pull Ups", ["lats"], "vertical_pull"],
    ["Upright Barbell Row", ["shoulders"], "raise"],
    ["Side Lateral Raise", ["shoulders"], "raise"],
    ["Lying Leg Curls", ["hamstrings"], "leg_curl"],
    ["Hammer Curls", ["biceps"], "curl"],
    ["Standing Dumbbell Triceps Extension", ["triceps"], "triceps_extension"],
    ["Dumbbell Flyes", ["chest"], "fly"],
    ["Standing Calf Raises", ["calves"], "calf_raise"],
    ["Farmer's Walk", ["forearms"], "carry"],
    ["Front Squat (Clean Grip)", ["quadriceps"], "squat"],
    ["Plank", ["abdominals"], "core"],
    ["Tire Flip", ["quadriceps"], null],
  ] as const)("%s → %s", (name, primaryMuscles, pattern) => {
    expect(
      map({ name, primaryMuscles: [...primaryMuscles] }).movementPattern,
    ).toBe(pattern);
  });

  it("tags olympic and plyometric categories by category", () => {
    expect(
      map({ category: "olympic weightlifting", name: "Hang Snatch" })
        .movementPattern,
    ).toBe("olympic");
    expect(map({ category: "plyometrics", name: "Box Jump" })).toMatchObject({
      movementPattern: "jump",
      stressTags: ["shoulder", "knee", "shin", "ankle_foot"],
    });
  });

  it("flags single-arm and single-leg work as unilateral", () => {
    expect(map({ name: "One-Arm Dumbbell Row" }).unilateral).toBe(true);
    expect(map({ name: "Single-Leg Romanian Deadlift" }).unilateral).toBe(true);
    expect(map({ name: "Dumbbell Bulgarian Split Squat" }).unilateral).toBe(
      true,
    );
    expect(map({ name: "Alternate Hammer Curl" }).unilateral).toBe(false);
    expect(map({ name: "Dumbbell Bench Press" }).unilateral).toBe(false);
  });

  it("uses e1rm_rir only for loaded main compounds", () => {
    expect(map({ name: "Dumbbell Bench Press" }).progressionModel).toBe(
      "e1rm_rir",
    );
    const accessory = map({ name: "Pushups", equipment: "body only" });
    expect(accessory).toMatchObject({
      progressionModel: "double_progression",
      repMin: 8,
      repMax: 12,
    });
    expect(
      map({
        name: "Leg Press",
        equipment: "machine",
        primaryMuscles: ["quadriceps"],
      }).progressionModel,
    ).toBe("double_progression");
    expect(
      map({
        name: "Hammer Curls",
        mechanic: "isolation",
        primaryMuscles: ["biceps"],
      }).progressionModel,
    ).toBe("double_progression");
  });

  it("falls back to the mechanic for groups without a pattern", () => {
    expect(
      map({
        name: "Tire Flip",
        mechanic: "compound",
        primaryMuscles: ["quadriceps"],
      }).substitutionGroup,
    ).toBe("compound:quadriceps");
    expect(map({ primaryMuscles: [] }).substitutionGroup).toBeNull();
  });

  it("adds abbreviated aliases", () => {
    expect(map({ name: "Kettlebell Swing" }).aliases).toEqual(["KB Swing"]);
    expect(map({ name: "Stiff-Legged Barbell Deadlift" }).aliases).toEqual([
      "Stiff-Legged BB Deadlift",
    ]);
    expect(map({ name: "Plank" }).aliases).toEqual([]);
  });
});

describe("vendored free-exercise-db", () => {
  it("is byte-for-byte the pinned commit's files", () => {
    for (const [name, { sha256 }] of Object.entries(FREE_EXERCISE_DB.files)) {
      const bytes = readFileSync(freeExerciseDbFile(name));
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(
        sha256,
      );
    }
  });

  const rawAll = loadRawFreeExerciseDb();
  const all = loadFreeExerciseDb();
  const rowSchema = exerciseSchema.omit({
    id: true,
    userId: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
    serverSeq: true,
  });

  it("imports everything except cardio", () => {
    const cardio = rawAll.filter((e) => e.category === "cardio").length;
    expect(cardio).toBeGreaterThan(0);
    expect(all).toHaveLength(rawAll.length - cardio);
    expect(new Set(all.map((e) => e.sourceId)).size).toBe(all.length);
  });

  it("gives every exercise and image the pinned source and license", () => {
    expect(FREE_EXERCISE_DB_SOURCE).toBe(
      `free-exercise-db@${FREE_EXERCISE_DB.commit}`,
    );
    for (const exercise of all) {
      expect(exercise.source).toBe(FREE_EXERCISE_DB_SOURCE);
      expect(exercise.license).toBe("Unlicense");
      for (const media of exercise.media) {
        expect(media.source).toBe(FREE_EXERCISE_DB_SOURCE);
        expect(media.license).toBe("Unlicense");
      }
    }
  });

  it("produces valid exercise rows", () => {
    for (const exercise of all) {
      expect(() => rowSchema.parse(exercise), exercise.name).not.toThrow();
    }
  });

  it("finds a pattern for most strength exercises", () => {
    const lifts = all.filter((e) => e.modality === "lift");
    const unmatched = lifts.filter((e) => e.movementPattern === null);
    expect(unmatched.length / lifts.length).toBeLessThan(0.15);
  });
});
