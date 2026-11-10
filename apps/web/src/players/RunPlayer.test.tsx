// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  localDateAt,
  newId,
  sessionLogId,
  type PlannedItem,
  type PlannedSession,
} from "@workout-app/shared";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSession } from "../plan/sessions";
import { Session } from "../screens/Session";
import { deviceTimezone } from "../settings/settings";
import { localDb } from "../sync";
import { readRunSession } from "./run-log";

const today = localDateAt(deviceTimezone(), Date.now());
const sync = {
  userId: 1,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  serverSeq: 1,
};

const easy: PlannedSession = {
  id: newId(),
  ...sync,
  weekId: null,
  date: today,
  slot: "am",
  modality: "run",
  workoutType: "easy",
  templateId: null,
  intent: "support",
  status: "planned",
  generatedBy: "engine@stub-1",
};

const segment: PlannedItem = {
  id: newId(),
  ...sync,
  plannedSessionId: easy.id,
  position: 0,
  kind: "run_segment",
  exerciseId: null,
  targets: {
    workoutType: "easy",
    distance: { value: 3, unit: "mi" },
    targetRpe: { min: 3, max: 4 },
  },
  reasons: [],
};

function renderPlayer() {
  return render(
    <MemoryRouter initialEntries={[`/session/${easy.id}`]}>
      <Routes>
        <Route path="/session/:id" element={<Session />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await Promise.all(localDb.tables.map((t) => t.clear()));
  await localDb.rows("planned_session").put(easy);
  await localDb.rows("planned_item").put(segment);
});
afterEach(cleanup);

describe("RunPlayer", () => {
  it("shows the planned run as bars and prefills its distance", async () => {
    renderPlayer();
    const bars = await screen.findByRole("list", { name: "Planned workout" });
    expect(within(bars).getByText("3 mi · RPE 3–4")).toBeTruthy();
    const form = screen.getByRole("form", { name: "Log run" });
    expect(
      within(form).getByLabelText<HTMLInputElement>("Distance (mi)").value,
    ).toBe("3");
    expect(
      within(form)
        .getByRole("radio", { name: "Easy" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("derives the pace, logs the run with splits and marks it done", async () => {
    const user = userEvent.setup();
    renderPlayer();
    const form = await screen.findByRole("form", { name: "Log run" });
    const save = within(form).getByRole("button", { name: "Save run" });
    expect(within(form).getByText("Pace –")).toBeTruthy();

    await user.clear(within(form).getByLabelText("Distance (mi)"));
    await user.type(within(form).getByLabelText("Distance (mi)"), "3.1");
    await user.type(within(form).getByLabelText("Minutes"), "26");
    await user.type(within(form).getByLabelText("Seconds"), "21");
    expect(within(form).getByText("Pace 8:30 /mi")).toBeTruthy();
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(form).getByRole("radio", { name: "4" }));

    await user.click(
      within(form).getByText("Heart rate, elevation and splits"),
    );
    await user.type(within(form).getByLabelText("Avg heart rate"), "148");
    await user.type(within(form).getByLabelText("Elevation gain (ft)"), "120");
    await user.click(within(form).getByRole("button", { name: "Add split" }));
    await user.type(within(form).getByLabelText("Split 1 minutes"), "8");
    await user.type(within(form).getByLabelText("Split 1 seconds"), "45");
    expect(within(form).getByText("Pace 8:45 /mi")).toBeTruthy();
    await user.type(within(form).getByLabelText("Notes"), "Felt easy");
    await user.click(save);

    const done = await screen.findByRole("region", { name: "Run logged" });
    expect(
      within(done).getByText("Easy run · 3.1 mi · 26:21 · 8:30 /mi · RPE 4"),
    ).toBeTruthy();
    expect(within(done).getByText("148 bpm · 120 ft gain")).toBeTruthy();
    expect(within(done).getByText("1. 1 mi in 8:45 (8:45 /mi)")).toBeTruthy();
    expect(within(done).getByText("Felt easy")).toBeTruthy();

    const { log, run } = await readRunSession(localDb, easy.id);
    expect(log).toMatchObject({ id: sessionLogId(easy.id), rpe: 4 });
    expect(log!.endedAt! - log!.startedAt).toBe(1581_000);
    expect(run).toMatchObject({
      distanceValue: 3.1,
      durationSec: 1581,
      avgHr: 148,
      elevationValue: 120,
      elevationUnit: "ft",
      splits: [{ distanceValue: 1, durationSec: 525 }],
    });
    const ops = await localDb.outbox.toArray();
    expect(ops.map((op) => op.entity)).toEqual(["session_log", "run_log"]);
    expect((await readSession(easy.id))?.session.status).toBe("done");
  });

  it("needs a distance, a duration and an RPE", async () => {
    const user = userEvent.setup();
    renderPlayer();
    const form = await screen.findByRole("form", { name: "Log run" });
    const save = within(form).getByRole("button", { name: "Save run" });
    await user.click(within(form).getByRole("radio", { name: "5" }));
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await user.type(within(form).getByLabelText("Minutes"), "30");
    expect((save as HTMLButtonElement).disabled).toBe(false);
    await user.clear(within(form).getByLabelText("Distance (mi)"));
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });
});
