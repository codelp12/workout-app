import { readFileSync } from "node:fs";
import { z } from "zod";
import { mapExercise, type ExerciseData } from "./map.js";
import { rawExerciseSchema, type RawExercise } from "./raw.js";
import {
  FREE_EXERCISE_DB,
  FREE_EXERCISE_DB_SOURCE,
  freeExerciseDbFile,
} from "./source.js";

/** The vendored dataset, validated against the upstream schema. */
export function loadRawFreeExerciseDb(): RawExercise[] {
  return z
    .array(rawExerciseSchema)
    .parse(
      JSON.parse(readFileSync(freeExerciseDbFile("exercises.json"), "utf8")),
    );
}

/** Every imported free-exercise-db exercise, mapped to our schema. */
export function loadFreeExerciseDb(): ExerciseData[] {
  const provenance = {
    source: FREE_EXERCISE_DB_SOURCE,
    license: FREE_EXERCISE_DB.license,
  };
  return loadRawFreeExerciseDb().flatMap(
    (raw) => mapExercise(raw, provenance) ?? [],
  );
}
