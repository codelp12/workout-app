// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  addDays,
  DEFAULT_EQUIPMENT,
  localDateAt,
  newId,
  sessionLogId,
  weekStartOf,
  type PlannedItem,
  type PlannedSession,
  type Template,
} from "@workout-app/shared";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testExercise } from "../library/test-exercise";
import { readHistory } from "../history/history";
import { Navigation } from "../Navigation";
import { combineLifts } from "../plan/combine";
import { moveSession } from "../plan/moves";
import { readSession, weekPlan } from "../plan/sessions";
import { finishSession, logSet, readLiftSession } from "../players/lift-log";
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
    (
      [
        "planned_session",
        "planned_item",
        "template",
        "exercise",
        "session_log",
        "set_log",
        "plan_override",
      ] as const
    ).map((t) => localDb.rows(t).clear()),
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
  it("confirms a same-slot lift combination and credits both plans through one log", async () => {
    const pull = session({ workoutType: "pull_a", slot: "pm" });
    const row = (await localDb.rows("planned_item").toArray()).find(
      (i) => i.plannedSessionId === push.id,
    )!;
    await localDb.rows("planned_session").put(pull);
    await localDb
      .rows("planned_item")
      .put({ ...row, id: newId(), plannedSessionId: pull.id });
    expect(await combineLifts(localDb, push.id, pull.id)).toBe(false);
    await moveSession(localDb, pull, pull, push);
    const user = userEvent.setup();
    renderAt(`/session/${push.id}`);
    const offer = await screen.findByRole("button", {
      name: "Combine with Pull A",
    });
    await user.click(offer);
    const confirmation = await screen.findByRole("dialog", {
      name: "Combine workouts?",
    });
    expect(confirmation.textContent).toContain("both planned lifts");
    expect(
      await localDb
        .rows("plan_override")
        .filter((o) => o.kind === "combine")
        .count(),
    ).toBe(0);
    await user.click(
      within(confirmation).getByRole("button", { name: "Combine workouts" }),
    );
    await screen.findByRole("heading", { level: 1, name: "Push A + Pull A" });

    const view = (await readSession(pull.id))!;
    expect(view.session.id).toBe(push.id);
    const { cards } = await readLiftSession(localDb, view);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.targets.sets).toBe(6);
    const player = within(screen.getByRole("region", { name: "Lift player" }));
    await user.click(await player.findByRole("radio", { name: "2" }));
    await user.click(player.getByRole("button", { name: "Log set" }));
    await player.findByRole("list", { name: "Sets" });
    await finishSession(localDb, view, { rpe: 8, notes: null });
    expect((await weekPlan(weekStartOf(today))).tally.current.lift).toEqual({
      planned: 2,
      done: 2,
    });
    expect(await readHistory(localDb)).toMatchObject([
      { log: { plannedSessionId: push.id }, title: "Push A + Pull A" },
    ]);
    expect((await readSession(pull.id))?.session.status).toBe("done");
  });

  it("keeps a completed combination credited if another device logs the absorbed lift", async () => {
    const pull = session({ workoutType: "pull_a" });
    await localDb.rows("planned_session").put(pull);
    const now = Date.now();
    expect(await combineLifts(localDb, push.id, pull.id, now)).toBe(true);
    const finished = {
      ...sync,
      id: sessionLogId(push.id),
      plannedSessionId: push.id,
      modality: "lift" as const,
      startedAt: now + 1,
      endedAt: now + 2,
      localDate: today,
      timezone: "UTC",
      rpe: null,
      notes: null,
      checked: [],
    };
    await localDb
      .rows("session_log")
      .bulkPut([
        finished,
        { ...finished, id: sessionLogId(pull.id), plannedSessionId: pull.id },
      ]);
    expect((await readSession(pull.id))?.session.id).toBe(push.id);
    expect(
      (await readHistory(localDb)).find(({ log }) => log.id === finished.id)
        ?.title,
    ).toBe("Push A + Pull A");
    expect((await weekPlan(weekStartOf(today))).tally.current.lift).toEqual({
      planned: 2,
      done: 2,
    });
  });

  it("rejects pairs on different dates or once either lift has started", async () => {
    const pull = session({ workoutType: "pull_a", date: addDays(today, 1) });
    await localDb.rows("planned_session").put(pull);
    expect(await combineLifts(localDb, push.id, pull.id)).toBe(false);
    await moveSession(localDb, pull, pull, push);
    const view = (await readSession(push.id))!;
    const { cards } = await readLiftSession(localDb, view);
    await logSet(
      localDb,
      view,
      cards[0]!,
      { load: 50, band: null, reps: 8, rir: 2 },
      {
        weightUnit: "lb",
        timezone: deviceTimezone(),
        equipment: DEFAULT_EQUIPMENT,
      },
    );
    expect(await combineLifts(localDb, push.id, pull.id)).toBe(false);
    expect(await combineLifts(localDb, pull.id, push.id)).toBe(false);
  });
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
    expect(await lift.findByText("Dumbbell Bench Press")).toBeTruthy();
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

  it("shows a session as done once its log is finished", async () => {
    await localDb.rows("session_log").clear();
    await localDb.rows("session_log").put({
      id: sessionLogId(push.id),
      ...sync,
      plannedSessionId: push.id,
      modality: "lift",
      startedAt: 1,
      endedAt: 2,
      localDate: today,
      timezone: "UTC",
      rpe: 7,
      notes: null,
      checked: [],
    });
    renderAt("/");
    const am = await slot("AM");
    const card = within(await am.findByRole("listitem", { name: "Push A" }));
    expect(await card.findByText("Done")).toBeTruthy();
    expect(card.queryByRole("button")).toBeNull();
    await localDb.rows("session_log").clear();
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
