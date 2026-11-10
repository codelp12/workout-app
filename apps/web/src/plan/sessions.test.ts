import {
  newId,
  type PlannedItem,
  type PlannedSession,
} from "@workout-app/shared";
import { describe, expect, it } from "vitest";
import {
  formatLongDate,
  formatRange,
  liftDetail,
  type LiftTargets,
  sessionSummary,
  sessionTitle,
  type SessionView,
} from "./sessions";

const session = (fields: Partial<PlannedSession>): PlannedSession => ({
  id: newId(),
  userId: 1,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  serverSeq: 1,
  weekId: null,
  date: "2026-11-09",
  slot: "am",
  modality: "lift",
  workoutType: "push_a",
  templateId: null,
  intent: "support",
  status: "planned",
  generatedBy: "engine@stub-1",
  ...fields,
});

const item = (
  kind: PlannedItem["kind"],
  targets: Record<string, unknown>,
): PlannedItem => ({
  id: newId(),
  userId: 1,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  serverSeq: 1,
  plannedSessionId: newId(),
  position: 0,
  kind,
  exerciseId: null,
  targets,
  reasons: [],
});

const view = (s: PlannedSession, items: PlannedItem[]): SessionView => ({
  session: s,
  planned: { date: s.date, slot: s.slot },
  title: "",
  items,
  exerciseNames: new Map(),
});

const lift: LiftTargets = {
  sets: 3,
  load: { value: 60, unit: "lb" },
  band: null,
  repMin: 6,
  repMax: 10,
  targetRir: 2,
  restSec: 150,
};

describe("session titles", () => {
  it("prefers the template name", () => {
    expect(sessionTitle(session({}), "My Push")).toBe("My Push");
  });

  it("names workout types without a template", () => {
    expect(sessionTitle(session({ workoutType: "legs_b" }), null)).toBe(
      "Legs B",
    );
    expect(sessionTitle(session({ workoutType: "long" }), null)).toBe(
      "Long run",
    );
    expect(sessionTitle(session({ workoutType: "limit" }), null)).toBe(
      "Limit climb",
    );
    expect(sessionTitle(session({ workoutType: "tempo" }), null)).toBe("Tempo");
  });
});

describe("session summaries", () => {
  it("counts a lift's exercises and sets", () => {
    const s = session({});
    expect(
      sessionSummary(view(s, [item("exercise", lift), item("exercise", lift)])),
    ).toBe("2 exercises · 6 sets");
    expect(sessionSummary(view(s, []))).toBe("No exercises yet");
  });

  it("gives a run's distance and effort", () => {
    const s = session({ modality: "run", workoutType: "easy" });
    expect(
      sessionSummary(
        view(s, [
          item("run_segment", {
            workoutType: "easy",
            distance: { value: 3.5, unit: "mi" },
            targetRpe: { min: 3, max: 4 },
          }),
        ]),
      ),
    ).toBe("3.5 mi · RPE 3–4");
    expect(
      sessionSummary(
        view(s, [
          item("run_segment", {
            workoutType: "easy",
            distance: null,
            targetRpe: { min: 7, max: 7 },
          }),
        ]),
      ),
    ).toBe("RPE 7");
  });

  it("gives a climb's grades and problem count", () => {
    const s = session({ modality: "climb", workoutType: "limit" });
    const targets = {
      workoutType: "limit",
      discipline: "boulder",
      grades: { min: "V4", max: "V6" },
      problems: { min: 3, max: 5 },
      maxHardAttempts: 12,
    };
    expect(sessionSummary(view(s, [item("climb_block", targets)]))).toBe(
      "V4–V6 · 3–5 problems",
    );
    expect(
      sessionSummary(
        view(s, [item("climb_block", { ...targets, grades: null })]),
      ),
    ).toBe("3–5 problems");
  });
});

describe("formatting", () => {
  it("formats ranges, dates and lift targets", () => {
    expect(formatRange({ min: 2, max: 2 })).toBe("2");
    expect(formatLongDate("2026-11-09")).toMatch(/Monday/);
    expect(liftDetail(lift)).toBe("3 × 6–10 · 60 lb · RIR 2 · rest 2:30");
    expect(
      liftDetail({
        ...lift,
        load: null,
        band: "Red",
        repMin: 12,
        repMax: 12,
        targetRir: null,
        restSec: 60,
      }),
    ).toBe("3 × 12 · Red · rest 1:00");
  });
});
