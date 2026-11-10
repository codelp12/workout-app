// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  addDays,
  localDateAt,
  newId,
  type PlannedItem,
  type PlannedSession,
  type Template,
} from "@workout-app/shared";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testExercise } from "../library/test-exercise";
import { Navigation } from "../Navigation";
import { deviceTimezone } from "../settings/settings";
import { localDb } from "../sync";

beforeAll(() => {
  window.scrollTo = () => {};
});

const today = localDateAt(deviceTimezone(), Date.now());
const sync = {
  userId: 1,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  serverSeq: 1,
};

const bench = testExercise({ name: "Dumbbell Bench Press" });
const pushA: Template = {
  id: newId(),
  ...sync,
  name: "Push A",
  modality: "lift",
  intensityClass: "heavy",
  intent: "support",
  slots: [],
};

const session = (fields: Partial<PlannedSession>): PlannedSession => ({
  id: newId(),
  ...sync,
  weekId: null,
  date: today,
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
  s: PlannedSession,
  kind: PlannedItem["kind"],
  targets: Record<string, unknown>,
  exerciseId: string | null = null,
): PlannedItem => ({
  id: newId(),
  ...sync,
  plannedSessionId: s.id,
  position: 0,
  kind,
  exerciseId,
  targets,
  reasons: [],
});

const push = session({ templateId: pushA.id });
const run = session({ slot: "pm", modality: "run", workoutType: "easy" });
const climb = session({
  date: addDays(today, 1),
  modality: "climb",
  workoutType: "limit",
});

beforeEach(async () => {
  await Promise.all(
    (["planned_session", "planned_item", "template", "exercise"] as const).map(
      (t) => localDb.rows(t).clear(),
    ),
  );
  await localDb.rows("exercise").put(bench);
  await localDb.rows("template").put(pushA);
  await localDb.rows("planned_session").bulkPut([push, run, climb]);
  await localDb.rows("planned_item").bulkPut([
    item(
      push,
      "exercise",
      {
        sets: 3,
        load: { value: 50, unit: "lb" },
        band: null,
        repMin: 6,
        repMax: 10,
        targetRir: 2,
        restSec: 180,
      },
      bench.id,
    ),
    item(run, "run_segment", {
      workoutType: "easy",
      distance: { value: 3, unit: "mi" },
      targetRpe: { min: 3, max: 4 },
    }),
  ]);
});
afterEach(cleanup);

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Navigation />
    </MemoryRouter>,
  );
}

const slot = async (name: string) =>
  within(await screen.findByRole("region", { name }));

describe("Today", () => {
  it("lists today's sessions by slot with a coach note", async () => {
    renderAt("/");
    const am = await slot("AM");
    const card = within(await am.findByRole("listitem", { name: "Push A" }));
    expect(card.getByText("Lifting")).toBeTruthy();
    expect(card.getByText("1 exercise · 3 sets")).toBeTruthy();
    const pm = await slot("PM");
    expect(pm.getByRole("listitem", { name: "Easy run" })).toBeTruthy();
    expect(pm.getByText("3 mi · RPE 3–4")).toBeTruthy();
    expect(screen.queryByText("Limit climb")).toBeNull();
    expect(screen.getByRole("region", { name: "Coach note" })).toBeTruthy();
  });

  it("opens each session in its modality's player", async () => {
    const user = userEvent.setup();
    renderAt("/");
    await user.click(
      await screen.findByRole("button", { name: "Start Push A" }),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Push A" }),
    ).toBeTruthy();
    const lift = within(screen.getByRole("region", { name: "Lift player" }));
    expect(lift.getByText("Dumbbell Bench Press")).toBeTruthy();
    expect(lift.getByText("3 × 6–10 · 50 lb · RIR 2 · rest 3:00")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(
      await screen.findByRole("button", { name: "Start Easy run" }),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Easy run" }),
    ).toBeTruthy();
    expect(screen.getByRole("region", { name: "Run player" })).toBeTruthy();
  });

  it("shows finished sessions without a Start button", async () => {
    await localDb
      .rows("planned_session")
      .put({ ...push, status: "done", updatedAt: 1 });
    renderAt("/");
    const am = await slot("AM");
    const card = within(await am.findByRole("listitem", { name: "Push A" }));
    expect(await card.findByText("Done")).toBeTruthy();
    expect(card.queryByRole("button")).toBeNull();
  });

  it("opens a climb in the climb player and handles a missing session", async () => {
    renderAt(`/session/${climb.id}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Limit climb" }),
    ).toBeTruthy();
    expect(screen.getByRole("region", { name: "Climb player" })).toBeTruthy();
    cleanup();
    renderAt(`/session/${newId()}`);
    expect(
      await screen.findByRole("heading", { name: "Session not found" }),
    ).toBeTruthy();
  });
});
