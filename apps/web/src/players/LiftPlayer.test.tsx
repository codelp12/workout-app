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
  defaultSettings,
  localDateAt,
  newId,
  sessionLogId,
  type PlannedItem,
  type PlannedSession,
  type SessionLog,
  type SetLog,
} from "@workout-app/shared";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testExercise } from "../library/test-exercise";
import { Session } from "../screens/Session";
import { deviceTimezone } from "../settings/settings";
import { localDb } from "../sync";
import { openWorkout, savePosition } from "./lift-log";

const today = localDateAt(deviceTimezone(), Date.now());
const sync = {
  userId: 1,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  serverSeq: 1,
};

const squat = testExercise({
  name: "Dumbbell Squat",
  equipment: ["dumbbell"],
  cues: ["Brace", "Knees out"],
});
const plank = testExercise({ name: "Plank", equipment: ["bodyweight"] });

const legs: PlannedSession = {
  id: newId(),
  ...sync,
  weekId: null,
  date: today,
  slot: "pm",
  modality: "lift",
  workoutType: "legs_a",
  templateId: null,
  intent: "key",
  status: "planned",
  generatedBy: "engine@stub-1",
};

const item = (
  position: number,
  exerciseId: string,
  targets: Record<string, unknown>,
): PlannedItem => ({
  id: newId(),
  ...sync,
  plannedSessionId: legs.id,
  position,
  kind: "exercise",
  exerciseId,
  targets,
  reasons: [],
});

const items = [
  item(0, squat.id, {
    sets: 2,
    load: { value: 50, unit: "lb" },
    band: null,
    repMin: 6,
    repMax: 10,
    targetRir: 2,
    restSec: 150,
  }),
  item(1, plank.id, {
    sets: 2,
    load: null,
    band: null,
    repMin: 30,
    repMax: 60,
    targetRir: null,
    restSec: 60,
  }),
];

const lastWeek: SessionLog = {
  id: newId(),
  ...sync,
  plannedSessionId: null,
  modality: "lift",
  startedAt: 1,
  endedAt: 2,
  localDate: "2026-01-05",
  timezone: "UTC",
  rpe: null,
  notes: null,
};
const lastSet = (index: number, reps: number): SetLog => ({
  id: newId(),
  ...sync,
  sessionLogId: lastWeek.id,
  exerciseId: squat.id,
  index,
  loadValue: 45,
  loadUnit: "lb",
  band: null,
  reps,
  rir: 2,
  isWarmup: false,
  completedAt: 2,
});

function renderPlayer() {
  return render(
    <MemoryRouter initialEntries={[`/session/${legs.id}`]}>
      <Routes>
        <Route path="/session/:id" element={<Session />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  localStorage.clear();
  await Promise.all(localDb.tables.map((t) => t.clear()));
  await localDb.rows("exercise").bulkPut([squat, plank]);
  await localDb.rows("planned_session").put(legs);
  await localDb.rows("planned_item").bulkPut(items);
  await localDb.rows("session_log").put(lastWeek);
  await localDb.rows("set_log").bulkPut([lastSet(0, 10), lastSet(1, 9)]);
});

afterEach(cleanup);

describe("LiftPlayer", () => {
  it("shows the target, last time and cues, prefilled from the target", async () => {
    renderPlayer();
    const card = await screen.findByRole("article", { name: "Dumbbell Squat" });
    expect(
      within(card).getByText("2 × 6–10 · 50 lb · RIR 2 · rest 2:30"),
    ).toBeTruthy();
    expect(
      within(card).getByText("45 lb × 10 · RIR 2, 45 lb × 9 · RIR 2"),
    ).toBeTruthy();
    expect(within(card).getByRole("list", { name: "Cues" }).textContent).toBe(
      "BraceKnees out",
    );
    expect(
      within(card).getByRole("button", { name: "Weight: 50 lb" }),
    ).toBeTruthy();
    expect(
      within(card)
        .getByRole("spinbutton", { name: "Reps" })
        .getAttribute("aria-valuenow"),
    ).toBe("10");
  });

  it("logs a prefilled set in two taps and starts the session log", async () => {
    const user = userEvent.setup();
    renderPlayer();
    const card = await screen.findByRole("article", { name: "Dumbbell Squat" });
    const log = within(card).getByRole("button", { name: "Log set" });
    expect((log as HTMLButtonElement).disabled).toBe(true);

    await user.click(within(card).getByRole("radio", { name: "2" }));
    await user.click(log);

    expect(await within(card).findByText("Set 2 of 2")).toBeTruthy();
    const session = await localDb
      .rows("session_log")
      .get(sessionLogId(legs.id));
    expect(session).toMatchObject({
      plannedSessionId: legs.id,
      modality: "lift",
      endedAt: null,
      localDate: today,
    });
    const sets = (await localDb.rows("set_log").toArray()).filter(
      (s) => s.sessionLogId === session!.id,
    );
    expect(sets).toEqual([
      expect.objectContaining({
        exerciseId: squat.id,
        index: 0,
        loadValue: 50,
        loadUnit: "lb",
        reps: 10,
        rir: 2,
        isWarmup: false,
      }),
    ]);
    const queued = await localDb.outbox.toArray();
    expect(queued.map((op) => op.entity)).toEqual(["session_log", "set_log"]);
    expect(await openWorkout(localDb, today)).toBe(legs.id);
  });

  it("moves to the next exercise after the last set and logs bodyweight sets", async () => {
    const user = userEvent.setup();
    renderPlayer();
    const squatCard = await screen.findByRole("article", {
      name: "Dumbbell Squat",
    });
    for (let set = 0; set < 2; set++) {
      await user.click(within(squatCard).getByRole("radio", { name: "1" }));
      await user.click(
        within(squatCard).getByRole("button", { name: "Log set" }),
      );
      await within(squatCard).findByText(/^(Set 2 of 2|All 2 sets done\.)$/);
    }
    const plankCard = await screen.findByRole("article", { name: "Plank" });
    expect(screen.getByText("Exercise 2 of 2")).toBeTruthy();
    expect(
      within(plankCard).queryByRole("group", { name: "Weight" }),
    ).toBeNull();
    // No target RIR, so one tap logs it.
    await user.click(
      within(plankCard).getByRole("button", { name: "Log set" }),
    );
    expect(await within(plankCard).findByText("Bodyweight × 60")).toBeTruthy();
    const plankSet = (await localDb.rows("set_log").toArray()).find(
      (s) => s.exerciseId === plank.id,
    );
    expect(plankSet).toMatchObject({
      loadValue: null,
      loadUnit: null,
      rir: null,
    });
  });

  it("swipes between exercises", async () => {
    renderPlayer();
    const player = await screen.findByRole("region", { name: "Lift player" });
    await screen.findByRole("article", { name: "Dumbbell Squat" });
    fireEvent.pointerDown(player, { clientX: 300 });
    fireEvent.pointerUp(player, { clientX: 100 });
    expect(await screen.findByRole("article", { name: "Plank" })).toBeTruthy();
    fireEvent.pointerDown(player, { clientX: 100 });
    fireEvent.pointerUp(player, { clientX: 300 });
    expect(
      await screen.findByRole("article", { name: "Dumbbell Squat" }),
    ).toBeTruthy();
  });

  it("resumes on the same card with logged sets and unlogged values after a kill", async () => {
    const user = userEvent.setup();
    const first = renderPlayer();
    const card = await screen.findByRole("article", { name: "Dumbbell Squat" });
    await user.click(within(card).getByRole("radio", { name: "2" }));
    await user.click(within(card).getByRole("button", { name: "Log set" }));
    await within(card).findByText("Set 2 of 2");
    await user.click(
      within(card).getByRole("button", { name: "Decrease Reps" }),
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("article", { name: "Plank" });
    await user.click(screen.getByRole("button", { name: "Previous" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    first.unmount();

    renderPlayer();
    expect(await screen.findByRole("article", { name: "Plank" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Previous" }));
    const again = await screen.findByRole("article", {
      name: "Dumbbell Squat",
    });
    expect(within(again).getByText("50 lb × 10 · RIR 2")).toBeTruthy();
    expect(within(again).getByText("Set 2 of 2")).toBeTruthy();
    expect(
      within(again)
        .getByRole("spinbutton", { name: "Reps" })
        .getAttribute("aria-valuenow"),
    ).toBe("9");
  });

  it("times the rest from the set, so it's right after a screen lock or a kill", async () => {
    let clock = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      const user = userEvent.setup();
      const first = renderPlayer();
      const card = await screen.findByRole("article", {
        name: "Dumbbell Squat",
      });
      expect(screen.queryByRole("region", { name: "Rest timer" })).toBeNull();
      await user.click(within(card).getByRole("radio", { name: "2" }));
      await user.click(within(card).getByRole("button", { name: "Log set" }));
      const timer = await screen.findByRole("region", { name: "Rest timer" });
      expect(within(timer).getByRole("timer").textContent).toBe("2:30");

      // Locked for 100 s: whatever ran meanwhile, it reads from the clock.
      clock += 100_000;
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(within(timer).getByRole("timer").textContent).toBe("0:50");

      first.unmount();
      clock += 20_000;
      renderPlayer();
      const resumed = await screen.findByRole("region", { name: "Rest timer" });
      expect(within(resumed).getByRole("timer").textContent).toBe("0:30");

      clock += 30_000;
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(within(resumed).getByRole("status").textContent).toBe("Rest over");
    } finally {
      vi.restoreAllMocks();
    }
  });

  describe("wake lock", () => {
    let visibility: DocumentVisibilityState = "visible";
    const sentinels: { released: boolean; release: () => Promise<void> }[] = [];
    const request = vi.fn(() => {
      const sentinel = {
        released: false,
        release: vi.fn(() => {
          sentinel.released = true;
          return Promise.resolve();
        }),
      };
      sentinels.push(sentinel);
      return Promise.resolve(sentinel);
    });

    beforeEach(() => {
      visibility = "visible";
      sentinels.length = 0;
      request.mockClear();
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: { request },
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => visibility,
      });
    });

    afterEach(() => {
      Reflect.deleteProperty(navigator, "wakeLock");
      Reflect.deleteProperty(document, "visibilityState");
    });

    function setVisibility(state: DocumentVisibilityState) {
      visibility = state;
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
    }

    it("keeps the screen on during the session, again after the app is hidden", async () => {
      const player = renderPlayer();
      await screen.findByRole("article", { name: "Dumbbell Squat" });
      await vi.waitFor(() => expect(request).toHaveBeenCalledWith("screen"));
      expect(request).toHaveBeenCalledTimes(1);

      // The browser drops the lock while hidden; it's taken again on return.
      sentinels[0]!.released = true;
      setVisibility("hidden");
      expect(request).toHaveBeenCalledTimes(1);
      setVisibility("visible");
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));

      player.unmount();
      expect(sentinels[1]!.release).toHaveBeenCalled();
    });

    it("lets the screen lock once the session is finished", async () => {
      const player = renderPlayer();
      await screen.findByRole("article", { name: "Dumbbell Squat" });
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      await localDb.rows("session_log").put({
        ...lastWeek,
        id: sessionLogId(legs.id),
        plannedSessionId: legs.id,
        localDate: today,
        endedAt: Date.now(),
      });
      await vi.waitFor(() => expect(sentinels[0]!.release).toHaveBeenCalled());
      player.unmount();
    });
  });

  describe("load picker", () => {
    const squatTargets = (load: number) => ({
      ...items[0]!.targets,
      load: { value: load, unit: "lb" },
    });

    it("never shows a weight the rack can't make", async () => {
      const user = userEvent.setup();
      await localDb
        .rows("planned_item")
        .put({ ...items[0]!, targets: squatTargets(52) });
      renderPlayer();
      const card = await screen.findByRole("article", {
        name: "Dumbbell Squat",
      });
      // 52 lb isn't on a 5 lb rack: the nearest is offered.
      await user.click(
        within(card).getByRole("button", { name: "Weight: 50 lb" }),
      );
      const sheet = await screen.findByRole("dialog", {
        name: "Pick a weight",
      });
      const offered = within(
        within(sheet).getByRole("list", { name: "Weight options" }),
      )
        .getAllByRole("button")
        .map((b) => Number.parseFloat(b.textContent));
      expect(offered).toEqual(
        Array.from({ length: 24 }, (_, i) => 5 * (i + 1)),
      );
      await user.click(within(sheet).getByRole("button", { name: "55 lb" }));
      await user.click(
        within(card).getByRole("button", { name: "Increase Weight" }),
      );
      await user.click(within(card).getByRole("radio", { name: "2" }));
      await user.click(within(card).getByRole("button", { name: "Log set" }));
      expect(await within(card).findByText("60 lb × 10 · RIR 2")).toBeTruthy();
    });

    it("snaps a saved weight to the rack after the equipment changes", async () => {
      await localDb.rows("settings").put({
        ...defaultSettings(deviceTimezone(), 0),
        ...sync,
        equipment: {
          ...defaultSettings(deviceTimezone(), 0).equipment,
          dumbbells: { min: 10, max: 60, step: 10 },
        },
      });
      savePosition(legs.id, {
        card: 0,
        drafts: {
          [items[0]!.id]: { load: 45, band: null, reps: 8, rir: null },
        },
      });
      renderPlayer();
      const card = await screen.findByRole("article", {
        name: "Dumbbell Squat",
      });
      expect(
        await within(card).findByRole("button", { name: "Weight: 40 lb" }),
      ).toBeTruthy();
    });

    it("says so and won't log when the equipment has no dumbbells", async () => {
      await localDb.rows("settings").put({
        ...defaultSettings(deviceTimezone(), 0),
        ...sync,
        equipment: {
          ...defaultSettings(deviceTimezone(), 0).equipment,
          dumbbells: null,
        },
      });
      renderPlayer();
      const card = await screen.findByRole("article", {
        name: "Dumbbell Squat",
      });
      expect(
        await within(card).findByText(/No dumbbells in your equipment/),
      ).toBeTruthy();
      expect(within(card).queryByRole("group", { name: "Weight" })).toBeNull();
      const log = within(card).getByRole("button", { name: "Log set" });
      expect((log as HTMLButtonElement).disabled).toBe(true);
    });

    it("offers the inventory's bands and logs the one picked", async () => {
      const user = userEvent.setup();
      const curl = testExercise({ name: "Band Curl", equipment: ["band"] });
      await localDb.rows("exercise").put(curl);
      await localDb.rows("planned_item").put({
        ...items[0]!,
        exerciseId: curl.id,
        targets: { ...items[0]!.targets, load: null, band: "Medium" },
      });
      renderPlayer();
      const card = await screen.findByRole("article", { name: "Band Curl" });
      const bands = within(card).getByRole("radiogroup", { name: "Band" });
      expect(
        within(bands)
          .getAllByRole("radio")
          .map((b) => b.textContent),
      ).toEqual(["Light", "Medium", "Heavy", "Extra heavy"]);
      expect(
        within(bands)
          .getByRole("radio", { name: "Medium" })
          .getAttribute("aria-checked"),
      ).toBe("true");
      await user.click(within(bands).getByRole("radio", { name: "Heavy" }));
      await user.click(within(card).getByRole("radio", { name: "2" }));
      await user.click(within(card).getByRole("button", { name: "Log set" }));
      expect(await within(card).findByText("Heavy × 10 · RIR 2")).toBeTruthy();
      const set = (await localDb.rows("set_log").toArray()).find(
        (s) => s.exerciseId === curl.id,
      );
      expect(set).toMatchObject({ loadValue: null, band: "Heavy" });
    });
  });
});
