// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rows } from "../history/test-rows";
import { testExercise } from "../library/test-exercise";
import { Navigation } from "../Navigation";
import { localDb } from "../sync";

beforeAll(() => {
  window.scrollTo = () => {};
});

const bench = testExercise({ name: "Dumbbell Bench Press" });
const lift = rows.log({ rpe: 8, notes: "Heavy but good" });
const run = rows.log({ modality: "run", localDate: "2026-11-10" });
const climb = rows.log({
  modality: "climb",
  localDate: "2026-11-03",
  endedAt: null,
});

beforeEach(async () => {
  await Promise.all(localDb.tables.map((t) => t.clear()));
  await localDb.rows("exercise").put(bench);
  await localDb.rows("session_log").bulkPut([lift, run, climb]);
  await localDb
    .rows("set_log")
    .bulkPut([
      rows.set(lift, { exerciseId: bench.id, index: 0 }),
      rows.set(lift, { exerciseId: bench.id, index: 1, reps: 7, rir: 1 }),
    ]);
  await localDb.rows("run_log").put(rows.run(run));
  await localDb
    .rows("ascent")
    .bulkPut([
      rows.ascent(climb, { grade: "V3" }),
      rows.ascent(climb, { grade: "V5", style: "attempt", attempts: 3 }),
    ]);
});

afterEach(cleanup);

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Navigation />
    </MemoryRouter>,
  );

describe("Log", () => {
  it("lists lift, run and climb sessions from the device, week by week", async () => {
    renderAt("/log");
    const thisWeek = await screen.findByRole("region", {
      name: /^Nov 9 – Nov 15$/,
    });
    const links = within(thisWeek).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      expect.stringContaining("Easy run3.1 mi · 26:21 · 8:30 /mi · RPE 4"),
      expect.stringContaining("Lifting session1 exercise · 2 sets · 45 min"),
    ]);
    const lastWeek = screen.getByRole("region", { name: /^Nov 2 – Nov 8$/ });
    expect(within(lastWeek).getByRole("link").textContent).toContain(
      "Not finished",
    );
  });

  it("filters by modality", async () => {
    const user = userEvent.setup();
    renderAt("/log");
    await screen.findByText("Easy run");
    await user.click(screen.getByRole("radio", { name: "Running" }));
    expect(screen.getAllByRole("link", { name: /3\.1 mi/ })).toHaveLength(1);
    expect(screen.queryByText("Lifting session")).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Climbing" }));
    expect(await screen.findByText(/1 send/)).toBeTruthy();
  });

  it("says when nothing is logged", async () => {
    await localDb.rows("session_log").clear();
    renderAt("/log?show=run");
    expect(
      await screen.findByText("No running sessions logged yet."),
    ).toBeTruthy();
  });
});

describe("Logged session", () => {
  it("shows a lift session's sets per exercise", async () => {
    const user = userEvent.setup();
    renderAt("/log");
    await user.click(
      await screen.findByRole("link", { name: /Lifting session/ }),
    );
    expect(
      await screen.findByRole("heading", { name: "Lifting session", level: 1 }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Summary" }).textContent,
    ).toContain("45 min · RPE 8Heavy but good");
    const exercise = screen.getByRole("region", {
      name: "Dumbbell Bench Press",
    });
    const sets = within(exercise).getAllByRole("listitem");
    expect(sets.map((s) => s.textContent)).toEqual([
      "Set 160 lb × 8 · RIR 2",
      "Set 260 lb × 7 · RIR 1",
    ]);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Log" })).toBeTruthy();
  });

  it("shows a run", async () => {
    renderAt(`/log/${run.id}`);
    const details = await screen.findByRole("region", { name: "Run" });
    expect(details.textContent).toContain("3.1 mi · 26:21 · 8:30 /mi · RPE 4");
  });

  it("shows a climb session's pyramid and climbs", async () => {
    renderAt(`/log/${climb.id}`);
    const pyramid = await screen.findByRole("region", { name: "Pyramid" });
    expect(
      within(pyramid).getByRole("listitem", { name: "V3: 1 send" }),
    ).toBeTruthy();
    const climbs = screen.getByRole("region", { name: "Climbs" });
    expect(
      within(climbs)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["V3 · Send", "V5 · Attempt · 3 attempts"]);
    expect(
      screen.getByRole("region", { name: "Summary" }).textContent,
    ).toContain("Not finished");
  });

  it("says when the log is gone", async () => {
    renderAt("/log/0190aaaa-0000-7000-8000-000000000000");
    expect(
      await screen.findByText("This session isn't in your log any more."),
    ).toBeTruthy();
  });
});
