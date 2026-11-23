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
  skipOverrideId,
  swapOverrideId,
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
  checked: [],
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

/** Waits until every set row on the card is logged. */
const logged = (card: HTMLElement) =>
  vi.waitFor(() =>
    expect(within(card).queryByRole("button", { name: "Log set" })).toBeNull(),
  );

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

    await logged(card);
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

  it("carries the RIR over to the next set under a visible label", async () => {
    const user = userEvent.setup();
    renderPlayer();
    const card = await screen.findByRole("article", { name: "Dumbbell Squat" });
    const rir = within(card).getByRole("radiogroup", {
      name: "Reps in reserve",
    });
    expect(within(card).getByText("Reps in reserve")).toBeTruthy();
    await user.click(within(rir).getByRole("radio", { name: "3" }));
    await user.click(within(card).getByRole("button", { name: "Log set" }));
    await logged(card);
    await user.click(within(card).getByRole("button", { name: "Add set" }));
    expect(within(card).getByRole("heading", { name: "Set 2" })).toBeTruthy();

    expect(
      within(card)
        .getByRole("radio", { name: "3" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    const log = within(card).getByRole("button", { name: "Log set" });
    expect((log as HTMLButtonElement).disabled).toBe(false);
  });

  it("moves on with Next exercise and adds weight to bodyweight sets", async () => {
    const user = userEvent.setup();
    renderPlayer();
    const squatCard = await screen.findByRole("article", {
      name: "Dumbbell Squat",
    });
    expect(
      within(squatCard).queryByRole("button", { name: "Next exercise" }),
    ).toBeNull();
    await user.click(within(squatCard).getByRole("radio", { name: "1" }));
    await user.click(
      within(squatCard).getByRole("button", { name: "Log set" }),
    );
    await user.click(
      await within(squatCard).findByRole("button", { name: "Next exercise" }),
    );
    const plankCard = await screen.findByRole("article", { name: "Plank" });
    expect(screen.getByText("Exercise 2 of 2")).toBeTruthy();
    expect(
      within(plankCard).getByRole("group", { name: "Added weight" }),
    ).toBeTruthy();
    // No target RIR, so one tap logs it.
    await user.click(
      within(plankCard).getByRole("button", { name: "Log set" }),
    );
    expect(await within(plankCard).findByText("Bodyweight × 60")).toBeTruthy();
    // The last card has nowhere to go next.
    expect(
      within(plankCard).queryByRole("button", { name: "Next exercise" }),
    ).toBeNull();
    await user.click(
      within(plankCard).getByRole("button", { name: "Add set" }),
    );
    await user.click(
      within(plankCard).getByRole("button", { name: "Increase Added weight" }),
    );
    await user.click(
      within(plankCard).getByRole("button", { name: "Log set" }),
    );
    expect(
      await within(plankCard).findByText("Bodyweight + 5 lb × 60"),
    ).toBeTruthy();
    const plankSets = (await localDb.rows("set_log").toArray())
      .filter((s) => s.exerciseId === plank.id)
      .sort((x, y) => x.index - y.index);
    expect(plankSets).toEqual([
      expect.objectContaining({
        index: 0,
        loadValue: null,
        loadUnit: null,
        rir: null,
      }),
      expect.objectContaining({ index: 1, loadValue: 5, loadUnit: "lb" }),
    ]);
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
    await logged(card);
    await user.click(within(card).getByRole("button", { name: "Add set" }));
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
    expect(within(again).getByRole("heading", { name: "Set 2" })).toBeTruthy();
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
          [items[0]!.id]: [{ load: 45, band: null, reps: 8, rir: null }],
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

    it("keeps the remaining draft's load when dumbbells are disabled and re-enabled", async () => {
      const settings = { ...defaultSettings(deviceTimezone(), 0), ...sync };
      await localDb.rows("settings").put({
        ...settings,
        equipment: { ...settings.equipment, dumbbells: null },
      });
      savePosition(legs.id, {
        card: 0,
        drafts: {
          [items[0]!.id]: [
            { load: 45, band: null, reps: 8, rir: 2 },
            { load: 50, band: null, reps: 9, rir: 2 },
          ],
        },
      });
      const user = userEvent.setup();
      renderPlayer();
      const card = within(
        await screen.findByRole("article", { name: "Dumbbell Squat" }),
      );
      expect(
        await card.findAllByText(/No dumbbells in your equipment/),
      ).toHaveLength(2);
      await user.click(card.getByRole("button", { name: "Remove set 2" }));
      await localDb.rows("settings").put(settings);
      expect(
        await card.findByRole("button", { name: "Weight: 45 lb" }),
      ).toBeTruthy();
      await user.click(card.getByRole("button", { name: "Log set" }));
      expect(await card.findByText("45 lb × 8 · RIR 2")).toBeTruthy();
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

describe("swap, skip, add set and warm-ups", () => {
  const sessionSets = async () =>
    (await localDb.rows("set_log").toArray())
      .filter((s) => s.sessionLogId === sessionLogId(legs.id))
      .sort((a, b) => a.completedAt! - b.completedAt!);

  it("swaps within the substitution group, dumbbell and band first, and queues it for sync", async () => {
    const user = userEvent.setup();
    const group = { substitutionGroup: "squat" };
    const barbell = testExercise({
      name: "Barbell Squat",
      equipment: ["barbell"],
      ...group,
    });
    const band = testExercise({
      name: "Band Squat",
      equipment: ["band"],
      ...group,
    });
    const press = testExercise({
      name: "Dumbbell Press",
      equipment: ["dumbbell"],
    });
    await localDb
      .rows("exercise")
      .bulkPut([{ ...squat, ...group }, barbell, band, press]);
    renderPlayer();
    const card = await screen.findByRole("article", { name: "Dumbbell Squat" });
    await user.click(within(card).getByRole("button", { name: "Swap" }));
    const sheet = await screen.findByRole("dialog", { name: "Swap exercise" });
    const options = within(
      within(sheet).getByRole("list", { name: "Substitutes" }),
    ).getAllByRole("button");
    expect(options.map((o) => o.firstChild?.textContent)).toEqual([
      "Dumbbell Squat",
      "Band Squat",
      "Barbell Squat",
    ]);
    expect(options[0]!.getAttribute("aria-pressed")).toBe("true");

    await user.click(options[2]!);
    const swapped = await screen.findByRole("article", {
      name: "Barbell Squat",
    });
    const override = await localDb
      .rows("plan_override")
      .get(swapOverrideId(items[0]!.id));
    expect(override).toMatchObject({
      kind: "swap",
      plannedSessionId: legs.id,
      data: { itemId: items[0]!.id, exerciseId: barbell.id },
    });
    const ops = await localDb.outbox.toArray();
    expect(ops.some((o) => o.opId === override!.opId)).toBe(true);

    await user.click(within(swapped).getByRole("radio", { name: "2" }));
    await user.click(within(swapped).getByRole("button", { name: "Log set" }));
    await logged(swapped);
    expect((await sessionSets()).map((s) => s.exerciseId)).toEqual([
      barbell.id,
    ]);
    // With a set logged under it, the swap is settled.
    await vi.waitFor(() =>
      expect(
        within(swapped).queryByRole("button", { name: "Swap" }),
      ).toBeNull(),
    );
  });

  it("swaps to any exercise by searching the library", async () => {
    const user = userEvent.setup();
    const press = testExercise({
      name: "Dumbbell Press",
      equipment: ["dumbbell"],
    });
    await localDb.rows("exercise").put(press);
    renderPlayer();
    const card = await screen.findByRole("article", { name: "Dumbbell Squat" });
    await user.click(within(card).getByRole("button", { name: "Swap" }));
    const sheet = await screen.findByRole("dialog", { name: "Swap exercise" });
    const search = within(sheet).getByRole("searchbox", {
      name: "Search exercises",
    });
    const substitutes = within(sheet).getByRole("list", {
      name: "Substitutes",
    });
    expect(
      search.compareDocumentPosition(substitutes) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(sheet).queryByRole("list", { name: "Exercises" })).toBeNull();
    await user.type(search, "zz");
    expect(within(sheet).getByRole("status").textContent).toBe(
      "No matching exercises.",
    );
    expect(
      within(sheet).queryByRole("list", { name: "Substitutes" }),
    ).toBeNull();
    await user.clear(search);
    expect(
      within(sheet).getByRole("list", { name: "Substitutes" }),
    ).toBeTruthy();
    await user.type(
      within(sheet).getByRole("searchbox", { name: "Search exercises" }),
      "press",
    );
    await user.click(
      within(within(sheet).getByRole("list", { name: "Exercises" })).getByRole(
        "button",
        { name: "Dumbbell Press" },
      ),
    );

    expect(
      await screen.findByRole("article", { name: "Dumbbell Press" }),
    ).toBeTruthy();
    const override = await localDb
      .rows("plan_override")
      .get(swapOverrideId(items[0]!.id));
    expect(override!.data).toEqual({
      itemId: items[0]!.id,
      exerciseId: press.id,
    });
  });

  it("adds the first exercise to an empty session", async () => {
    const user = userEvent.setup();
    await localDb.rows("planned_item").clear();
    renderPlayer();
    expect(
      await screen.findByText("Nothing is planned for this session yet."),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add exercise" }));
    await user.click(
      within(
        await screen.findByRole("dialog", { name: "Add an exercise" }),
      ).getByRole("button", { name: "Plank" }),
    );
    expect(await screen.findByRole("article", { name: "Plank" })).toBeTruthy();
  });

  it("adds an exercise to the end, queues it for sync and logs it", async () => {
    const user = userEvent.setup();
    const curl = testExercise({
      name: "Dumbbell Curl",
      equipment: ["dumbbell"],
      repMin: 10,
      repMax: 15,
    });
    await localDb.rows("exercise").put(curl);
    renderPlayer();
    await screen.findByRole("article", { name: "Dumbbell Squat" });
    await user.click(screen.getByRole("button", { name: "Add exercise" }));
    const sheet = await screen.findByRole("dialog", {
      name: "Add an exercise",
    });
    expect(
      within(sheet).queryByRole("button", { name: "Dumbbell Squat" }),
    ).toBeNull();
    await user.type(
      within(sheet).getByRole("searchbox", { name: "Search exercises" }),
      "curl",
    );
    await user.click(
      within(sheet).getByRole("button", { name: "Dumbbell Curl" }),
    );

    const card = await screen.findByRole("article", { name: "Dumbbell Curl" });
    expect(screen.getByText("Exercise 3 of 3")).toBeTruthy();
    expect(within(card).getByText(/^3 × 10–15/)).toBeTruthy();
    const [added] = (await localDb.rows("plan_override").toArray()).filter(
      (o) => o.kind === "add",
    );
    expect(added).toMatchObject({
      plannedSessionId: legs.id,
      data: { exerciseId: curl.id },
    });
    const ops = await localDb.outbox.toArray();
    expect(ops.some((o) => o.opId === added!.opId)).toBe(true);

    await user.click(within(card).getByRole("radio", { name: "2" }));
    await user.click(within(card).getByRole("button", { name: "Log set" }));
    await logged(card);
    expect((await sessionSets()).map((s) => s.exerciseId)).toEqual([curl.id]);
  });

  it("skips an exercise, queues it for sync and can undo it", async () => {
    const user = userEvent.setup();
    renderPlayer();
    const card = await screen.findByRole("article", { name: "Dumbbell Squat" });
    await user.click(within(card).getByRole("button", { name: "Skip" }));

    expect(await screen.findByRole("article", { name: "Plank" })).toBeTruthy();
    const override = await localDb
      .rows("plan_override")
      .get(skipOverrideId(items[0]!.id));
    expect(override).toMatchObject({
      kind: "trim",
      deletedAt: null,
      data: { itemId: items[0]!.id },
    });
    const ops = await localDb.outbox.toArray();
    expect(ops.some((o) => o.opId === override!.opId)).toBe(true);

    await user.click(screen.getByRole("button", { name: "Previous" }));
    const skipped = await screen.findByRole("article", {
      name: "Dumbbell Squat",
    });
    expect(within(skipped).getByText("Skipped.")).toBeTruthy();
    expect(
      within(skipped).queryByRole("button", { name: "Log set" }),
    ).toBeNull();
    await user.click(
      within(skipped).getByRole("button", { name: "Undo skip" }),
    );
    expect(
      await within(skipped).findByRole("heading", { name: "Set 1" }),
    ).toBeTruthy();
    const undone = await localDb
      .rows("plan_override")
      .get(skipOverrideId(items[0]!.id));
    expect(undone?.deletedAt).not.toBeNull();
  });

  it("starts with one set row, adds copies of the last and removes unlogged ones", async () => {
    const user = userEvent.setup();
    renderPlayer();
    const card = await screen.findByRole("article", { name: "Dumbbell Squat" });
    const rows = () =>
      within(card)
        .queryAllByRole("region", { name: /^Set \d$/ })
        .map((r) => r.getAttribute("aria-label"));
    const row = (name: string) =>
      within(within(card).getByRole("region", { name }));
    expect(rows()).toEqual(["Set 1"]);
    expect(
      within(card).queryByRole("button", { name: "Remove set 1" }),
    ).toBeNull();

    await user.click(
      row("Set 1").getByRole("button", { name: "Decrease Reps" }),
    );
    await user.click(within(card).getByRole("button", { name: "Add set" }));
    await user.click(within(card).getByRole("button", { name: "Add set" }));
    expect(rows()).toEqual(["Set 1", "Set 2", "Set 3"]);
    expect(
      row("Set 3")
        .getByRole("spinbutton", { name: "Reps" })
        .getAttribute("aria-valuenow"),
    ).toBe("9");
    await user.click(
      within(card).getByRole("button", { name: "Remove set 3" }),
    );
    expect(rows()).toEqual(["Set 1", "Set 2"]);

    for (const name of ["Set 1", "Set 2"]) {
      const set = within(await within(card).findByRole("region", { name }));
      await user.click(set.getByRole("radio", { name: "2" }));
      await user.click(set.getByRole("button", { name: "Log set" }));
      await within(within(card).getByRole("list", { name: "Sets" })).findByText(
        name,
      );
    }
    await logged(card);
    expect(rows()).toEqual([]);
    await user.click(within(card).getByRole("button", { name: "Add set" }));
    expect(rows()).toEqual(["Set 3"]);
    await user.click(row("Set 3").getByRole("radio", { name: "1" }));
    await user.click(row("Set 3").getByRole("button", { name: "Log set" }));
    await logged(card);
    expect((await sessionSets()).map((s) => [s.index, s.reps])).toEqual([
      [0, 9],
      [1, 9],
      [2, 9],
    ]);
  });

  it("focuses an added set and drops it if untouched when advancing", async () => {
    const user = userEvent.setup();
    renderPlayer();
    const card = await screen.findByRole("article", { name: "Dumbbell Squat" });
    await user.click(within(card).getByRole("radio", { name: "2" }));
    await user.click(within(card).getByRole("button", { name: "Log set" }));
    await logged(card);

    await user.click(within(card).getByRole("button", { name: "Add set" }));
    expect(document.activeElement).toBe(
      within(card).getByRole("region", { name: "Set 2" }),
    );
    await user.click(
      within(card).getByRole("button", { name: "Next exercise" }),
    );
    const nav = screen.getByRole("navigation", { name: "Exercises" });
    await user.click(within(nav).getByRole("button", { name: "Previous" }));
    const returned = await screen.findByRole("article", {
      name: "Dumbbell Squat",
    });
    expect(
      within(returned).queryByRole("region", { name: "Set 2" }),
    ).toBeNull();
    expect(await sessionSets()).toHaveLength(1);
  });

  it("keeps an editable first set after leaving an exercise with only an untouched extra", async () => {
    const user = userEvent.setup();
    renderPlayer();
    const card = within(
      await screen.findByRole("article", { name: "Dumbbell Squat" }),
    );
    await user.click(card.getByRole("button", { name: "Add set" }));
    await user.click(card.getByRole("button", { name: "Remove set 1" }));
    const nav = within(screen.getByRole("navigation", { name: "Exercises" }));
    await user.click(nav.getByRole("button", { name: /^Next$/ }));
    await screen.findByRole("article", { name: "Plank" });
    await user.click(nav.getByRole("button", { name: "Previous" }));
    const returned = within(
      await screen.findByRole("article", { name: "Dumbbell Squat" }),
    );
    await user.click(returned.getByRole("radio", { name: "2" }));
    await user.click(returned.getByRole("button", { name: "Log set" }));
    await logged(screen.getByRole("article", { name: "Dumbbell Squat" }));
    expect(await sessionSets()).toHaveLength(1);
  });

  it("collapses the warm-ups and logs them flagged, outside the working sets", async () => {
    const user = userEvent.setup();
    // An earlier warm-up stays out of "Last time".
    await localDb
      .rows("set_log")
      .put({ ...lastSet(0, 8), id: newId(), loadValue: 20, isWarmup: true });
    renderPlayer();
    const card = await screen.findByRole("article", { name: "Dumbbell Squat" });
    expect(
      within(card).getByText("45 lb × 10 · RIR 2, 45 lb × 9 · RIR 2"),
    ).toBeTruthy();
    const details = card.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(within(card).getByText("Warm-up · 0 of 3")).toBeTruthy();
    await user.click(within(card).getByText("Warm-up · 0 of 3"));
    expect(details.open).toBe(true);
    const list = within(card).getByRole("list", { name: "Warm-up sets" });
    expect(
      [...list.querySelectorAll("li")].map((li) => li.firstChild?.textContent),
    ).toEqual([
      "Warm-up 1 20 lb × 8",
      "Warm-up 2 30 lb × 5",
      "Warm-up 3 40 lb × 3",
    ]);
    const second = within(list).getByRole("button", { name: "Log warm-up 2" });
    expect((second as HTMLButtonElement).disabled).toBe(true);

    await user.click(
      within(list).getByRole("button", { name: "Log warm-up 1" }),
    );
    expect(await within(card).findByText("Warm-up · 1 of 3")).toBeTruthy();
    expect(within(card).getByRole("heading", { name: "Set 1" })).toBeTruthy();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(await sessionSets()).toEqual([
      expect.objectContaining({
        exerciseId: squat.id,
        index: 0,
        loadValue: 20,
        reps: 8,
        rir: null,
        isWarmup: true,
      }),
    ]);

    await user.click(within(card).getByRole("radio", { name: "2" }));
    await user.click(within(card).getByRole("button", { name: "Log set" }));
    await logged(card);
    const [, working] = await sessionSets();
    expect(working).toMatchObject({ index: 0, loadValue: 50, isWarmup: false });
  });

  it("has no warm-ups on a bodyweight card", async () => {
    savePosition(legs.id, { card: 1, drafts: {} });
    renderPlayer();
    const card = await screen.findByRole("article", { name: "Plank" });
    expect(card.querySelector("details")).toBeNull();
  });
});

describe("discarding", () => {
  it("deletes the sets and log after confirming, so the session starts over", async () => {
    const user = userEvent.setup();
    renderPlayer();
    const card = await screen.findByRole("article", { name: "Dumbbell Squat" });
    expect(
      screen.queryByRole("button", { name: "Discard workout" }),
    ).toBeNull();
    await user.click(within(card).getByRole("radio", { name: "2" }));
    await user.click(within(card).getByRole("button", { name: "Log set" }));
    await logged(card);

    await user.click(screen.getByRole("button", { name: "Discard workout" }));
    const sheet = await screen.findByRole("dialog", {
      name: "Discard workout?",
    });
    await user.click(within(sheet).getByRole("button", { name: "Keep going" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(card).getByText("50 lb × 10 · RIR 2")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Discard workout" }));
    await user.click(
      within(
        await screen.findByRole("dialog", { name: "Discard workout?" }),
      ).getByRole("button", { name: "Discard workout" }),
    );

    const fresh = await screen.findByRole("article", {
      name: "Dumbbell Squat",
    });
    expect(
      await within(fresh).findByRole("heading", { name: "Set 1" }),
    ).toBeTruthy();
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Discard workout" }),
      ).toBeNull(),
    );
    const log = await localDb.rows("session_log").get(sessionLogId(legs.id));
    expect(log!.deletedAt).not.toBeNull();
    const sets = (await localDb.rows("set_log").toArray()).filter(
      (s) => s.sessionLogId === sessionLogId(legs.id),
    );
    expect(sets.length).toBe(1);
    expect(sets.every((s) => s.deletedAt !== null)).toBe(true);
    const history = (await localDb.rows("set_log").toArray()).filter(
      (s) => s.sessionLogId === lastWeek.id,
    );
    expect(history.map((s) => s.deletedAt)).toEqual([null, null]);
    const deletes = (await localDb.outbox.toArray()).filter(
      (op) => op.action === "delete",
    );
    expect(deletes.map((op) => op.entity).sort()).toEqual([
      "session_log",
      "set_log",
    ]);
    expect(await openWorkout(localDb, today)).toBeNull();

    // Logging again starts a new log under the same id.
    await user.click(within(fresh).getByRole("radio", { name: "2" }));
    await user.click(within(fresh).getByRole("button", { name: "Log set" }));
    await logged(fresh);
    const again = await localDb.rows("session_log").get(sessionLogId(legs.id));
    expect(again!.deletedAt).toBeNull();
  });
});

describe("finishing", () => {
  it("finishes with RPE and notes, marks the session done and queues it for sync", async () => {
    await localDb.rows("checklist").put({
      ...sync,
      id: newId(),
      kind: "stretch",
      sessionType: "legs",
      items: [
        {
          id: "stretch-calf",
          name: "Calf stretch",
          detail: "20–30 s per side",
        },
      ],
    });
    const user = userEvent.setup();
    const { unmount } = renderPlayer();
    const card = await screen.findByRole("article", { name: "Dumbbell Squat" });
    const trigger = screen.getByRole("button", { name: "Finish workout" });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Log a set to finish the workout.")).toBeTruthy();
    await user.click(within(card).getByRole("radio", { name: "2" }));
    await user.click(within(card).getByRole("button", { name: "Log set" }));
    await logged(card);

    await user.click(
      await screen.findByRole("button", { name: "Finish workout" }),
    );
    const sheet = await screen.findByRole("dialog", { name: "Finish workout" });
    const finish = within(sheet).getByRole("button", { name: "Finish" });
    expect((finish as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(sheet).getByRole("radio", { name: "7" }));
    await user.type(within(sheet).getByLabelText("Notes"), "  Felt strong ");
    await user.click(finish);

    const done = await screen.findByRole("region", {
      name: "Workout finished",
    });
    expect(
      within(done).getByText(/1 working set · \d+ min · RPE 7/),
    ).toBeTruthy();
    expect(within(done).getByText("Felt strong")).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
    expect(
      await screen.findByRole("checkbox", { name: /Calf stretch/ }),
    ).toBeTruthy();

    const log = await localDb.rows("session_log").get(sessionLogId(legs.id));
    expect(log).toMatchObject({ rpe: 7, notes: "Felt strong" });
    expect(log!.endedAt).toBeGreaterThanOrEqual(log!.startedAt);
    const queued = await localDb.outbox.toArray();
    expect(queued.filter((op) => op.entity === "session_log")).toHaveLength(2);
    expect(await openWorkout(localDb, today)).toBeNull();

    unmount();
    renderPlayer();
    expect(
      await screen.findByRole("region", { name: "Workout finished" }),
    ).toBeTruthy();
  });
});
