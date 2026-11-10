// @vitest-environment jsdom
import "fake-indexeddb/auto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  localDateAt,
  newId,
  type PlannedItem,
  type PlannedSession,
} from "@workout-app/shared";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSession } from "../plan/sessions";
import { Session } from "../screens/Session";
import { deviceTimezone } from "../settings/settings";
import { localDb } from "../sync";

const today = localDateAt(deviceTimezone(), Date.now());
const sync = {
  userId: 1,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  serverSeq: 1,
};

const limit: PlannedSession = {
  id: newId(),
  ...sync,
  weekId: null,
  date: today,
  slot: "pm",
  modality: "climb",
  workoutType: "limit",
  templateId: null,
  intent: "key",
  status: "planned",
  generatedBy: "engine@stub-1",
};

const block: PlannedItem = {
  id: newId(),
  ...sync,
  plannedSessionId: limit.id,
  position: 0,
  kind: "climb_block",
  exerciseId: null,
  targets: {
    workoutType: "limit",
    discipline: "boulder",
    grades: { min: "V3", max: "V5" },
    problems: { min: 3, max: 5 },
    maxHardAttempts: 12,
  },
  reasons: [],
};

function renderPlayer() {
  return render(
    <MemoryRouter initialEntries={[`/session/${limit.id}`]}>
      <Routes>
        <Route path="/session/:id" element={<Session />} />
      </Routes>
    </MemoryRouter>,
  );
}

const pyramidRow = (name: string) =>
  within(screen.getByRole("region", { name: "Pyramid" })).findByRole(
    "listitem",
    { name },
  );

beforeEach(async () => {
  await Promise.all(localDb.tables.map((t) => t.clear()));
  await localDb.rows("planned_session").put(limit);
  await localDb.rows("planned_item").put(block);
});
afterEach(cleanup);

describe("ClimbPlayer", () => {
  it("shows the plan and updates the pyramid live as grades are tapped", async () => {
    const user = userEvent.setup();
    renderPlayer();
    const plan = await screen.findByRole("list", { name: "Planned climb" });
    expect(within(plan).getByText("V3–V5")).toBeTruthy();
    expect(
      within(plan).getByText("3–5 problems · up to 12 hard attempts"),
    ).toBeTruthy();
    expect(screen.getByText("Your sends show up here.")).toBeTruthy();

    const grades = screen.getByRole("group", { name: "Grades" });
    await user.click(within(grades).getByRole("button", { name: "V3" }));
    expect(await pyramidRow("V3: 1 send")).toBeTruthy();
    expect(screen.getByRole("timer")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Logged V3 send.");

    await user.click(within(grades).getByRole("button", { name: "V5" }));
    await user.click(within(grades).getByRole("button", { name: "V3" }));
    expect(await pyramidRow("V3: 2 sends")).toBeTruthy();
    expect(await pyramidRow("V4: 0 sends")).toBeTruthy();
    expect(await pyramidRow("V5: 1 send")).toBeTruthy();
    expect(screen.getByText("3 sends · 3 attempts · hardest V5")).toBeTruthy();
    const ascents = await localDb.rows("ascent").toArray();
    expect(ascents.map((a) => a.grade).sort()).toEqual(["V3", "V3", "V5"]);
  });

  it("opens the sheet on a long press to log attempts on a new project", async () => {
    const user = userEvent.setup();
    renderPlayer();
    const grades = await screen.findByRole("group", { name: "Grades" });
    const v6 = within(grades).getByRole("button", { name: "V6" });
    fireEvent.pointerDown(v6);
    await act(() => new Promise((r) => setTimeout(r, 600)));
    fireEvent.pointerUp(v6);
    fireEvent.click(v6);
    const sheet = await screen.findByRole("dialog", { name: "Log a climb" });
    expect(
      within(sheet)
        .getByRole("radio", { name: "V6" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    await user.click(within(sheet).getByRole("radio", { name: "Attempt" }));
    await user.click(
      within(sheet).getByRole("button", { name: "Increase Attempts" }),
    );
    await user.click(
      within(sheet).getByRole("button", { name: "Increase Attempts" }),
    );
    await user.click(within(sheet).getByRole("button", { name: "overhang" }));
    await user.click(within(sheet).getByRole("radio", { name: "New project" }));
    const logButton = within(sheet).getByRole<HTMLButtonElement>("button", {
      name: "Log climb",
    });
    expect(logButton.disabled).toBe(true);
    await user.type(within(sheet).getByLabelText("Project name"), "Roof");
    await user.click(logButton);

    const projects = await screen.findByRole("region", { name: "Projects" });
    expect(await within(projects).findByText("Roof · V6")).toBeTruthy();
    expect(
      within(projects).getByText("3 attempts over 1 session"),
    ).toBeTruthy();
    // An attempt isn't a send, and the tap after the hold logged nothing.
    expect(screen.getByText("Your sends show up here.")).toBeTruthy();
    const ascents = await localDb.rows("ascent").toArray();
    expect(ascents).toHaveLength(1);
    expect(ascents[0]).toMatchObject({
      grade: "V6",
      style: "attempt",
      attempts: 3,
      tags: ["overhang"],
    });
  });

  it("carries project attempts over from earlier sessions and marks the send", async () => {
    const user = userEvent.setup();
    const projectId = newId();
    const earlierLog = newId();
    await localDb.rows("project").put({
      id: projectId,
      ...sync,
      name: "Blue arete",
      grade: "V5",
      status: "active",
      sentAt: null,
      notes: null,
    });
    await localDb.rows("ascent").put({
      id: newId(),
      ...sync,
      sessionLogId: earlierLog,
      projectId,
      grade: "V5",
      style: "attempt",
      attempts: 4,
      tags: [],
    });
    renderPlayer();
    const projects = await screen.findByRole("region", { name: "Projects" });
    expect(
      await within(projects).findByText("4 attempts over 1 session"),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "More options" }));
    const sheet = await screen.findByRole("dialog", { name: "Log a climb" });
    await user.click(within(sheet).getByRole("radio", { name: "V5" }));
    await user.click(
      within(sheet).getByRole("radio", { name: "Blue arete (V5)" }),
    );
    await user.click(within(sheet).getByRole("button", { name: "Log climb" }));

    expect(
      await within(projects).findByText("5 attempts over 2 sessions"),
    ).toBeTruthy();
    expect(await within(projects).findByText("· Sent")).toBeTruthy();
    expect((await localDb.rows("project").get(projectId))!.status).toBe("sent");
  });

  it("edits or deletes a logged climb", async () => {
    const user = userEvent.setup();
    renderPlayer();
    const grades = await screen.findByRole("group", { name: "Grades" });
    await user.click(within(grades).getByRole("button", { name: "V4" }));
    const list = await screen.findByRole("list", { name: "This session" });
    await user.click(within(list).getByRole("button", { name: "V4 · Send" }));
    let sheet = await screen.findByRole("dialog", { name: "Edit V4" });
    await user.click(within(sheet).getByRole("radio", { name: "Flash" }));
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await user.click(
      await within(list).findByRole("button", { name: "V4 · Flash" }),
    );
    sheet = await screen.findByRole("dialog", { name: "Edit V4" });
    await user.click(
      within(sheet).getByRole("button", { name: "Delete climb" }),
    );
    expect(await screen.findByText("Your sends show up here.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "This session" })).toBeNull();
  });

  it("finishes with an RPE into a read-only summary and marks the session done", async () => {
    const user = userEvent.setup();
    renderPlayer();
    expect(screen.queryByRole("button", { name: "Finish session" })).toBeNull();
    const start = await screen.findByRole("button", { name: "Start session" });
    await user.click(start);
    expect(await screen.findByRole("timer")).toBeTruthy();
    const grades = screen.getByRole("group", { name: "Grades" });
    await user.click(within(grades).getByRole("button", { name: "V4" }));
    await user.click(
      await screen.findByRole("button", { name: "Finish session" }),
    );
    const sheet = await screen.findByRole("dialog", { name: "Finish session" });
    await user.click(within(sheet).getByRole("radio", { name: "7" }));
    await user.click(within(sheet).getByRole("button", { name: "Finish" }));

    const done = await screen.findByRole("region", {
      name: "Session finished",
    });
    expect(
      within(done).getByText("1 send · hardest V4 · 1 min · RPE 7"),
    ).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Grades" })).toBeNull();
    expect(await pyramidRow("V4: 1 send")).toBeTruthy();
    const view = await readSession(limit.id);
    expect(view?.session.status).toBe("done");
    const ops = await localDb.outbox.toArray();
    expect(ops.map((op) => op.entity)).toEqual([
      "session_log",
      "ascent",
      "session_log",
    ]);
  });
});
