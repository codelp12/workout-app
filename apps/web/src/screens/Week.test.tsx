// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  addDays,
  localDateAt,
  moveOverrideId,
  newId,
  weekStartOf,
  type PlannedSession,
  type PlanOverride,
  type SessionLog,
  type Template,
} from "@workout-app/shared";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Navigation } from "../Navigation";
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
