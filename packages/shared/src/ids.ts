import { v5, v7 } from "uuid";

/** A new UUIDv7: time-ordered, so ids sort by creation time (SPEC §3.2). */
export function newId(): string {
  return v7();
}

// Fixed namespace for library ids; changing it would re-key every exercise.
const LIBRARY_NAMESPACE = "6f1d6a3e-3c55-4a8e-9a43-2f5f0c7e5b21";

/**
 * The id of a seeded library exercise: a UUIDv5 of its dataset and id there,
 * e.g. ("free-exercise-db", "Pushups"). Every server and device derives the
 * same id, so templates can point at it and reseeding finds existing rows.
 */
export function libraryExerciseId(dataset: string, sourceId: string): string {
  return v5(`${dataset}:${sourceId}`, LIBRARY_NAMESPACE);
}

/**
 * The id of a default template, e.g. `push_a`: a UUIDv5, so every server
 * seeds the same row and reseeding finds it.
 */
export function defaultTemplateId(key: string): string {
  return v5(`default-template:${key}`, LIBRARY_NAMESPACE);
}

// Plan rows get ids derived from their week, so the phone's provisional week
// and the server's (SPEC §3.2) are the same rows and a pull replaces them.

/** The id of the block that starts on `startDate`. */
export function blockId(startDate: string): string {
  return v5(`block:${startDate}`, LIBRARY_NAMESPACE);
}

/** The id of the week that starts on Monday `startDate`. */
export function weekId(startDate: string): string {
  return v5(`week:${startDate}`, LIBRARY_NAMESPACE);
}

/** The id of a week's generated session, e.g. ("2026-11-02", "push_a"). */
export function plannedSessionId(weekStart: string, key: string): string {
  return v5(`planned-session:${weekStart}:${key}`, LIBRARY_NAMESPACE);
}

export function plannedItemId(sessionId: string, position: number): string {
  return v5(`planned-item:${sessionId}:${position}`, LIBRARY_NAMESPACE);
}

/**
 * The id of the `move` override for a planned session: one per session, so
 * moving it again updates the same row and last-write-wins settles races.
 */
export function moveOverrideId(sessionId: string): string {
  return v5(`move-override:${sessionId}`, LIBRARY_NAMESPACE);
}
