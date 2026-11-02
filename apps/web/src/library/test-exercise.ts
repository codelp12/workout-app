import { newId, type Exercise } from "@workout-app/shared";

/** A minimal synced exercise row for tests. */
export function testExercise(fields: Partial<Exercise> = {}): Exercise {
  return {
    id: newId(),
    userId: 1,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    serverSeq: 1,
    name: "Exercise",
    aliases: [],
    modality: "lift",
    movementPattern: null,
    primaryMuscles: [],
    secondaryMuscles: [],
    equipment: [],
    mechanic: null,
    unilateral: false,
    progressionModel: null,
    increment: null,
    repMin: null,
    repMax: null,
    stressTags: [],
    substitutionGroup: null,
    instructions: [],
    cues: [],
    commonMistakes: [],
    media: [],
    source: "free-exercise-db@test",
    license: "Unlicense",
    sourceId: null,
    notes: null,
    ...fields,
  };
}
