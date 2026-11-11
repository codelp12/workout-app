import { libraryExerciseId } from "./ids.js";

/**
 * The main compounds whose working weights onboarding asks for (SPEC §5.1
 * `e1rm_rir`), as free-exercise-db ids from the default templates.
 */
export const MAIN_LIFTS = [
  { sourceId: "Split_Squat_with_Dumbbells", name: "Dumbbell split squat" },
  { sourceId: "Dumbbell_Bench_Press", name: "Dumbbell bench press" },
  {
    sourceId: "Kettlebell_One-Legged_Deadlift",
    name: "Single-leg dumbbell RDL",
  },
  { sourceId: "Seated_Dumbbell_Press", name: "Dumbbell overhead press" },
  { sourceId: "One-Arm_Dumbbell_Row", name: "One-arm dumbbell row" },
].map((lift) => ({
  ...lift,
  exerciseId: libraryExerciseId("free-exercise-db", lift.sourceId),
}));
