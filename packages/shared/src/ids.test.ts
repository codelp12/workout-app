import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  libraryExerciseId,
  moveOverrideId,
  plannedSessionId,
  sessionLogId,
} from "./ids.js";

describe("libraryExerciseId", () => {
  it("is a stable UUID per dataset and source id", () => {
    const id = libraryExerciseId("free-exercise-db", "Pushups");
    expect(z.uuid().safeParse(id).success).toBe(true);
    expect(libraryExerciseId("free-exercise-db", "Pushups")).toBe(id);
    expect(libraryExerciseId("free-exercise-db", "Plank")).not.toBe(id);
    expect(libraryExerciseId("other-db", "Pushups")).not.toBe(id);
  });
});

describe("moveOverrideId", () => {
  it("is one stable UUID per planned session", () => {
    const session = plannedSessionId("2026-11-09", "push_a");
    const id = moveOverrideId(session);
    expect(z.uuid().safeParse(id).success).toBe(true);
    expect(moveOverrideId(session)).toBe(id);
    expect(id).not.toBe(session);
    expect(moveOverrideId(plannedSessionId("2026-11-09", "push_b"))).not.toBe(
      id,
    );
  });
});

describe("sessionLogId", () => {
  it("is one stable UUID per planned session", () => {
    const session = plannedSessionId("2026-11-09", "legs_a");
    const id = sessionLogId(session);
    expect(z.uuid().safeParse(id).success).toBe(true);
    expect(sessionLogId(session)).toBe(id);
    expect(id).not.toBe(moveOverrideId(session));
  });
});
