// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  addDays,
  defaultSettings,
  localDateAt,
  moveOverrideId,
  newId,
  SETTINGS_ID,
  sessionLogId,
  weekStartOf,
  type PlannedSession,
  type PlanOverride,
  type SetLog,
  type SessionLog,
  type Template,
} from "@workout-app/shared";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Navigation } from "../Navigation";
import { testExercise } from "../library/test-exercise";
import { readWeeklyLiftReview } from "../plan/lift-review";
import { formatLongDate, formatShortDay } from "../plan/sessions";
import { deviceTimezone } from "../settings/settings";
import { localDb } from "../sync";

beforeAll(() => {
  window.scrollTo = () => {};
});

const today = localDateAt(deviceTimezone(), Date.now());
const monday = weekStartOf(today);
const sync = {
  userId: 1,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  serverSeq: 1,
};

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
  date: monday,
  slot: "am",
  modality: "lift",
  workoutType: "push_a",
  templateId: null,
  intent: "support",
  status: "planned",
  generatedBy: "engine@stub-1",
  ...fields,
});

const push = session({ templateId: pushA.id });
const run = session({
  date: addDays(monday, 2),
  slot: "pm",
  modality: "run",
  workoutType: "easy",
});
const climb = session({
  date: addDays(monday, 4),
  slot: "pm",
  modality: "climb",
  workoutType: "limit",
});

const log = (fields: Partial<SessionLog>): SessionLog => ({
  id: newId(),
  ...sync,
  plannedSessionId: null,
  modality: "lift",
  startedAt: 0,
  endedAt: 1,
  localDate: monday,
  timezone: "UTC",
  rpe: null,
  notes: null,
  checked: [],
  ...fields,
});

beforeEach(async () => {
  await Promise.all(
    (
      [
        "planned_session",
        "planned_item",
        "plan_override",
        "session_log",
        "set_log",
        "exercise",
        "settings",
        "template",
      ] as const
    ).map((t) => localDb.rows(t).clear()),
  );
  await localDb.outbox.clear();
  await localDb.rows("template").put(pushA);
  await localDb.rows("planned_session").bulkPut([push, run, climb]);
});
afterEach(cleanup);

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Navigation />
    </MemoryRouter>,
  );
}

const day = async (offset: number) =>
  within(
    await screen.findByRole("listitem", {
      name: formatLongDate(addDays(monday, offset)),
    }),
  );

const radio = (group: string, name: string) =>
  within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", {
    name,
  });

describe("Week", () => {
  it("shows the week's sessions by day and slot", async () => {
    renderAt("/week");
    const mon = await day(0);
    expect(await mon.findByRole("button", { name: "Push A, AM" })).toBeTruthy();
    expect(mon.getByText("PM: nothing planned")).toBeTruthy();
    expect(
      (await day(2)).getByRole("button", { name: "Easy run, PM" }),
    ).toBeTruthy();
    expect(
      (await day(4)).getByRole("button", { name: "Limit climb, PM" }),
    ).toBeTruthy();
    const current = screen
      .getAllByRole("listitem")
      .find((li) => li.getAttribute("aria-current") === "date");
    expect(current?.getAttribute("aria-label")).toBe(formatLongDate(today));
  });

  it("filters to one modality, in the URL", async () => {
    const user = userEvent.setup();
    renderAt("/week");
    await (await day(0)).findByRole("button", { name: "Push A, AM" });
    await user.click(radio("Show", "Running"));
    expect(
      await screen.findByRole("button", { name: "Easy run, PM" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Push A, AM" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Limit climb, PM" }),
    ).toBeNull();
    const tally = within(screen.getByRole("table"));
    expect(tally.getByRole("rowheader", { name: "Running" })).toBeTruthy();
    expect(tally.queryByRole("rowheader", { name: "Lifting" })).toBeNull();

    cleanup();
    renderAt("/week?show=climb");
    expect(
      await screen.findByRole("button", { name: "Limit climb, PM" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Easy run, PM" })).toBeNull();
  });

  it("moves a session as a synced override and can put it back", async () => {
    const user = userEvent.setup();
    renderAt("/week");
    await user.click(
      await (await day(0)).findByRole("button", { name: "Push A, AM" }),
    );
    const sheet = within(await screen.findByRole("dialog", { name: "Push A" }));
    const move = sheet.getByRole("button", { name: "Move" });
    expect((move as HTMLButtonElement).disabled).toBe(true);
    await user.click(radio("Day", formatShortDay(addDays(monday, 5))));
    await user.click(radio("Time", "PM"));
    await user.click(move);

    const sat = await day(5);
    expect(
      await sat.findByRole("button", { name: "Push A, PM, moved" }),
    ).toBeTruthy();
    expect(
      (await day(0)).queryByRole("button", { name: /^Push A/ }),
    ).toBeNull();

    const override = await localDb
      .rows("plan_override")
      .get(moveOverrideId(push.id));
    expect(override).toMatchObject({
      kind: "move",
      plannedSessionId: push.id,
      data: { date: addDays(monday, 5), slot: "pm" },
      deletedAt: null,
    });
    const ops = await localDb.outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      entity: "plan_override",
      opId: override!.opId,
    });

    await user.click(sat.getByRole("button", { name: "Push A, PM, moved" }));
    const again = within(await screen.findByRole("dialog", { name: "Push A" }));
    expect(again.getByText(/^Planned for /)).toBeTruthy();
    await user.click(again.getByRole("button", { name: "Put back" }));
    expect(
      await (await day(0)).findByRole("button", { name: "Push A, AM" }),
    ).toBeTruthy();
    const removed = await localDb
      .rows("plan_override")
      .get(moveOverrideId(push.id));
    expect(removed?.deletedAt).not.toBeNull();
  });

  it("labels an open log and offers to resume it", async () => {
    await localDb.rows("session_log").put(
      log({
        id: sessionLogId(push.id),
        plannedSessionId: push.id,
        endedAt: null,
      }),
    );
    const user = userEvent.setup();
    renderAt("/week");
    await user.click(
      await screen.findByRole("button", { name: "Push A, AM, In progress" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Resume session",
      }),
    );
    expect(
      await screen.findByRole("region", { name: "Lift player" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Workout overview" }),
    ).toBeNull();
  });

  it("keeps finished sessions in place", async () => {
    const user = userEvent.setup();
    await localDb
      .rows("planned_session")
      .put({ ...run, status: "done", updatedAt: 1 });
    renderAt("/week");
    await user.click(
      await (await day(2)).findByRole("button", { name: "Easy run, PM, Done" }),
    );
    const sheet = within(
      await screen.findByRole("dialog", { name: "Easy run" }),
    );
    expect(sheet.getByText("Done sessions stay where they are.")).toBeTruthy();
    expect(sheet.queryByRole("button", { name: "Move" })).toBeNull();
  });

  it("compares sessions done of planned with last week", async () => {
    const lastWeek = addDays(monday, -7);
    await localDb
      .rows("planned_session")
      .bulkPut([
        session({ date: lastWeek }),
        session({ date: addDays(lastWeek, 1) }),
      ]);
    await localDb
      .rows("session_log")
      .bulkPut([
        log({ localDate: lastWeek }),
        log({ localDate: addDays(lastWeek, 1), endedAt: null }),
        log({ localDate: monday }),
        log({ localDate: monday, deletedAt: 1 }),
      ]);
    renderAt("/week");
    const lifting = within(
      (await screen.findByRole("rowheader", { name: "Lifting" })).closest(
        "tr",
      )!,
    );
    expect(lifting.getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "1 of 2",
      "1 of 1",
    ]);
    const running = within(
      screen.getByRole("rowheader", { name: "Running" }).closest("tr")!,
    );
    expect(running.getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "–",
      "0 of 1",
    ]);
  });

  it("shows last week's lift review and hard sets per muscle", async () => {
    const bench = testExercise({
      name: "Dumbbell Bench Press",
      equipment: ["dumbbell"],
      primaryMuscles: ["chest", "triceps"],
    });
    const fly = testExercise({
      name: "Cable Fly",
      equipment: ["cable"],
      primaryMuscles: ["chest"],
    });
    const plank = testExercise({
      name: "Plank",
      sourceId: "Plank",
      primaryMuscles: ["abs"],
    });
    const previous = session({
      date: addDays(monday, -7),
      templateId: null,
    });
    const previousLog = log({
      id: sessionLogId(previous.id),
      plannedSessionId: previous.id,
      localDate: previous.date,
      startedAt: 10,
      endedAt: 20,
    });
    const onboardingSettings = {
      ...defaultSettings("UTC", 0),
      ...sync,
      id: SETTINGS_ID,
      onboarding: {
        completedAt: 0,
        lifts: [
          {
            exerciseId: bench.id,
            load: { value: 100, unit: "lb" as const },
            reps: 8,
            rir: 2,
          },
        ],
        run: null,
        climb: null,
      },
    };
    const targets = {
      sets: 3,
      load: { value: 140, unit: "lb" },
      band: null,
      repMin: 8,
      repMax: 10,
      targetRir: 2,
      restSec: 120,
    };
    const plannedItem = {
      id: newId(),
      ...sync,
      plannedSessionId: push.id,
      position: 0,
      kind: "exercise" as const,
      exerciseId: bench.id,
      targets,
      reasons: ["The plan set this target."],
    };
    const sets: SetLog[] = Array.from({ length: 3 }, (_, index) => ({
      id: newId(),
      ...sync,
      sessionLogId: previousLog.id,
      exerciseId: bench.id,
      index,
      loadValue: 135,
      loadUnit: "lb",
      band: null,
      reps: 8,
      rir: 2,
      isWarmup: false,
      completedAt: 20 + index,
    }));
    const flySets: SetLog[] = Array.from({ length: 18 }, (_, index) => ({
      id: newId(),
      ...sync,
      sessionLogId: previousLog.id,
      exerciseId: fly.id,
      index: index + 3,
      loadValue: 45,
      loadUnit: "lb",
      band: null,
      reps: 8,
      rir: 2,
      isWarmup: false,
      completedAt: 23 + index,
    }));
    const plankSets: SetLog[] = Array.from({ length: 3 }, (_, index) => ({
      id: newId(),
      ...sync,
      sessionLogId: previousLog.id,
      exerciseId: plank.id,
      index: index + 21,
      loadValue: null,
      loadUnit: null,
      band: null,
      reps: 30,
      rir: null,
      isWarmup: false,
      completedAt: 41 + index,
    }));
    await localDb.rows("exercise").bulkPut([bench, fly, plank]);
    await localDb.rows("settings").put(onboardingSettings);
    await localDb.rows("planned_session").put(previous);
    await localDb.rows("planned_item").put(plannedItem);
    await localDb.rows("session_log").put(previousLog);
    await localDb.rows("set_log").bulkPut([...sets, ...flySets, ...plankSets]);

    const localReview = await readWeeklyLiftReview(monday);
    expect(localReview.exercises).toHaveLength(3);
    expect(localReview.muscles).toContainEqual({
      muscle: "chest",
      hardSets: 21,
      cap: 20,
    });

    renderAt("/week");
    const reviewElement = await screen.findByRole("region", {
      name: "Last week's lifting",
    });
    const review = within(reviewElement);
    expect(
      screen
        .getByRole("list", { name: "Days" })
        .compareDocumentPosition(reviewElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const exerciseRowElement = (
      await review.findByRole("heading", {
        level: 3,
        name: "Dumbbell Bench Press",
      })
    ).closest("li")!;
    const exerciseRow = within(exerciseRowElement);
    expect(exerciseRowElement.textContent).toContain(
      "Top set 135 lb × 8 · 3 sets · 24 reps",
    );
    expect(exerciseRowElement.textContent).toMatch(
      /e1RM \d+(?:\.\d+)? lb \(\+\d+(?:\.\d+)? lb\)/,
    );
    expect(exerciseRowElement.textContent).toContain(
      "This week: 3 × 8–10 · 140 lb · RIR 2 · rest 2:00",
    );
    expect(exerciseRow.getByText("The plan set this target.")).toBeTruthy();
    const plankRow = (
      await review.findByRole("heading", { level: 3, name: "Plank" })
    ).closest("li")!;
    expect(plankRow.textContent).toContain(
      "Top set Bodyweight × 30 s · 3 sets · 90 s total",
    );
    const muscles = within(
      review.getByRole("heading", { name: "Hard sets per muscle" })
        .parentElement!,
    );
    expect(muscles.getByText("Chest")).toBeTruthy();
    expect(muscles.getByText("Triceps")).toBeTruthy();
    expect(muscles.getByText("21 / 20")).toBeTruthy();
    expect(muscles.getByText("Over cap")).toBeTruthy();
    expect(muscles.getAllByText("3 / 20")).toHaveLength(2);
  });

  it("shows the empty lift review when last week has no working sets", async () => {
    renderAt("/week");
    const review = within(
      await screen.findByRole("region", { name: "Last week's lifting" }),
    );
    expect(
      await review.findByText("No lifting logged last week."),
    ).toBeTruthy();
  });
});

describe("moved sessions elsewhere", () => {
  it("show on Today on the day they were moved to", async () => {
    const override: PlanOverride = {
      id: moveOverrideId(climb.id),
      ...sync,
      kind: "move",
      plannedSessionId: climb.id,
      weekId: null,
      data: { date: today, slot: "am" },
      opId: newId(),
      supersededAt: null,
    };
    await localDb.rows("plan_override").put(override);
    renderAt("/");
    const am = within(await screen.findByRole("region", { name: "AM" }));
    expect(
      await am.findByRole("listitem", { name: "Limit climb" }),
    ).toBeTruthy();
    cleanup();
    renderAt(`/session/${climb.id}`);
    expect(
      await screen.findByText(`${formatLongDate(today)}, AM`),
    ).toBeTruthy();
  });
});
