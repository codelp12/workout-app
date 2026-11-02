import { libraryExerciseId } from "./ids.js";

/**
 * The main compounds whose working weights onboarding asks for (SPEC §5.1
 * `e1rm_rir`), as free-exercise-db ids from the default templates.
 */
export const MAIN_LIFTS = [
  { sourceId: "Dumbbell_Squat", name: "Dumbbell squat" },
  { sourceId: "Dumbbell_Bench_Press", name: "Dumbbell bench press" },
  { sourceId: "Stiff-Legged_Dumbbell_Deadlift", name: "Dumbbell RDL" },
  { sourceId: "Seated_Dumbbell_Press", name: "Dumbbell overhead press" },
  { sourceId: "One-Arm_Dumbbell_Row", name: "One-arm dumbbell row" },
].map((lift) => ({
  ...lift,
  exerciseId: libraryExerciseId("free-exercise-db", lift.sourceId),
}));
