import {
  defaultTemplates,
  loadFreeExerciseDb,
} from "@workout-app/exercise-data";
import { libraryExerciseId } from "@workout-app/shared";
import type { Db } from "./db.js";
import { exercise, template } from "./schema.js";
import { OWNER_USER_ID, nextSeq } from "./sync.js";

export const LIBRARY_DATASET = "free-exercise-db";

/**
 * Adds every free-exercise-db exercise the database doesn't have yet (SPEC
 * §7) and returns how many it added. Existing rows, including edited or
 * deleted ones, are left alone, so running it on every start is safe. Each
 * new row gets a `serverSeq`, so devices receive it on their next pull.
 */
export function seedExercises(db: Db, now = Date.now()): number {
  const exercises = loadFreeExerciseDb();
  return db.transaction((tx) => {
    const existing = new Set(
      tx
        .select({ id: exercise.id })
        .from(exercise)
        .all()
        .map((row) => row.id),
    );
    let added = 0;
    for (const data of exercises) {
      if (!data.sourceId) throw new Error(`${data.name} has no sourceId`);
      const id = libraryExerciseId(LIBRARY_DATASET, data.sourceId);
      if (existing.has(id)) continue;
      tx.insert(exercise)
        .values({
          ...data,
          id,
          userId: OWNER_USER_ID,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          serverSeq: nextSeq(tx),
          notes: null,
        })
        .run();
      added++;
    }
    return added;
  });
}

/**
 * Adds the default Push/Pull/Legs templates the database doesn't have yet
 * (SPEC §5.1) and returns how many it added. Like {@link seedExercises}, it
 * never touches an existing row, so edits and deletions survive restarts.
 */
export function seedTemplates(db: Db, now = Date.now()): number {
  return db.transaction((tx) => {
    const existing = new Set(
      tx
        .select({ id: template.id })
        .from(template)
        .all()
        .map((row) => row.id),
    );
    let added = 0;
    for (const data of defaultTemplates()) {
      if (existing.has(data.id)) continue;
      tx.insert(template)
        .values({
          ...data,
          userId: OWNER_USER_ID,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          serverSeq: nextSeq(tx),
        })
        .run();
      added++;
    }
    return added;
  });
}
