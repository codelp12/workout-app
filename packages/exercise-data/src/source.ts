import { readFileSync } from "node:fs";
import { z } from "zod";

const dataDir = new URL("../data/free-exercise-db/", import.meta.url);

const sourceSchema = z.object({
  repo: z.string(),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  license: z.string(),
  files: z.record(
    z.string(),
    z.object({ path: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
  ),
});
export type DatasetSource = z.infer<typeof sourceSchema>;

/** Path of a vendored free-exercise-db file, e.g. `exercises.json`. */
export function freeExerciseDbFile(name: string): URL {
  return new URL(name, dataDir);
}

/** The pinned commit and file hashes, written by `scripts/import.js`. */
export const FREE_EXERCISE_DB: DatasetSource = sourceSchema.parse(
  JSON.parse(readFileSync(freeExerciseDbFile("source.json"), "utf8")),
);

/** The `source` stamped on every imported exercise and image. */
export const FREE_EXERCISE_DB_SOURCE = `free-exercise-db@${FREE_EXERCISE_DB.commit}`;
