import { describe, expect, it } from "vitest";
import { z } from "zod";
import { libraryExerciseId } from "./ids.js";

describe("libraryExerciseId", () => {
  it("is a stable UUID per dataset and source id", () => {
    const id = libraryExerciseId("free-exercise-db", "Pushups");
    expect(z.uuid().safeParse(id).success).toBe(true);
    expect(libraryExerciseId("free-exercise-db", "Pushups")).toBe(id);
    expect(libraryExerciseId("free-exercise-db", "Plank")).not.toBe(id);
    expect(libraryExerciseId("other-db", "Pushups")).not.toBe(id);
  });
});
