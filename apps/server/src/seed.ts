import {
  PREVIOUS_DEFAULT_TEMPLATES,
  defaultTemplates,
  loadFreeExerciseDb,
  type DefaultTemplateData,
} from "@workout-app/exercise-data";
import { libraryExerciseId } from "@workout-app/shared";
import { eq } from "drizzle-orm";
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

function sameTemplate(a: DefaultTemplateData, b: DefaultTemplateData) {
  const fields = (t: DefaultTemplateData) => [
    t.name,
    t.modality,
    t.intensityClass,
    t.intent,
    t.slots.map((s) => [
      s.exerciseId,
      s.substitutionGroup,
      s.sets,
      s.repMin,
      s.repMax,
      s.targetRir,
      s.restSec,
      s.ramp,
    ]),
  ];
  return JSON.stringify(fields(a)) === JSON.stringify(fields(b));
}

/**
 * Adds the default Push/Pull/Legs templates the database doesn't have yet
 * (SPEC §5.1), and upgrades any that still exactly match an earlier default
 * version. Templates the owner edited or deleted are never touched, so they
 * survive restarts. Upgraded rows get a new `serverSeq`, so devices receive
 * them on their next pull.
 */
export function seedTemplates(
  db: Db,
  now = Date.now(),
): { added: number; upgraded: number } {
  const previous = PREVIOUS_DEFAULT_TEMPLATES.map((v) => defaultTemplates(v));
  return db.transaction((tx) => {
    const existing = new Map(
      tx
        .select()
        .from(template)
        .all()
        .map((row) => [row.id, row]),
    );
    let added = 0;
    let upgraded = 0;
    for (const data of defaultTemplates()) {
      const row = existing.get(data.id);
      if (row) {
        const stale =
          row.deletedAt === null &&
          !sameTemplate(row, data) &&
          previous.some((v) =>
            v.some((old) => old.id === data.id && sameTemplate(row, old)),
          );
        if (stale) {
          tx.update(template)
            .set({ ...data, updatedAt: now, serverSeq: nextSeq(tx) })
            .where(eq(template.id, data.id))
            .run();
          upgraded++;
        }
        continue;
      }
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
    return { added, upgraded };
  });
}
