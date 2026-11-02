// @vitest-environment jsdom
import "fake-indexeddb/auto";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { newId, type Template } from "@workout-app/shared";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ToastProvider } from "../components/Toast";
import { testExercise } from "../library/test-exercise";
import { Navigation } from "../Navigation";
import { localDb } from "../sync";

beforeAll(() => {
  window.scrollTo = () => {};
  if (!("hasPointerCapture" in Element.prototype))
    Object.assign(Element.prototype, {
      hasPointerCapture: () => false,
      releasePointerCapture: () => {},
    });
});

const bench = testExercise({ name: "Dumbbell Bench Press" });
const press = testExercise({ name: "Seated Dumbbell Press" });
const curl = testExercise({ name: "Hammer Curls", repMin: 8, repMax: 12 });
const stretch = testExercise({ name: "Hammer Stretch", modality: "mobility" });

const slot = (exerciseId: string, ramp: boolean) => ({
  exerciseId,
  substitutionGroup: null,
  sets: 3,
  repMin: 6,
  repMax: 10,
  targetRir: 2,
  restSec: 180,
  ramp,
});

const pushA: Template = {
  id: newId(),
  userId: 1,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  serverSeq: 1,
  name: "Push A",
  modality: "lift",
  intensityClass: "heavy",
  intent: "support",
  slots: [slot(bench.id, true), slot(press.id, true)],
};

beforeEach(async () => {
  await Promise.all(
    [localDb.rows("exercise"), localDb.rows("template"), localDb.outbox].map(
      (t) => t.clear(),
    ),
  );
  await localDb.rows("exercise").bulkPut([bench, press, curl, stretch]);
  await localDb.rows("template").put(pushA);
});
afterEach(cleanup);

const saved = () => localDb.rows("template").get(pushA.id);
const card = (name: RegExp) => within(screen.getByRole("region", { name }));

describe("template editor", () => {
  it("is listed in Settings and edits save through the outbox", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/settings"]}>
          <Navigation />
        </MemoryRouter>
      </ToastProvider>,
    );
    await user.click(await screen.findByRole("link", { name: /Push A/ }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Push A" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Settings" })
        .getAttribute("aria-current"),
    ).toBe("page");

    const benchCard = await screen.findByRole("region", {
      name: /Dumbbell Bench Press/,
    });
    await user.click(
      within(benchCard).getByRole("button", { name: "Increase Sets" }),
    );
    await waitFor(async () => expect((await saved())?.slots[0]?.sets).toBe(4));

    await user.click(
      within(benchCard).getByRole("button", { name: "Increase Max reps" }),
    );
    await user.click(within(benchCard).getByRole("radio", { name: "1" }));
    await user.click(
      within(benchCard).getByRole("button", { name: "Decrease Rest" }),
    );
    await user.click(
      within(benchCard).getByRole("button", {
        name: "Add a set in loading weeks",
      }),
    );
    await waitFor(async () =>
      expect((await saved())?.slots[0]).toEqual({
        ...slot(bench.id, false),
        sets: 4,
        repMax: 11,
        targetRir: 1,
        restSec: 165,
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "Move Dumbbell Bench Press down" }),
    );
    await waitFor(async () =>
      expect((await saved())?.slots.map((s) => s.exerciseId)).toEqual([
        press.id,
        bench.id,
      ]),
    );
    expect(
      card(/^1\. Seated Dumbbell Press/).getByRole<HTMLButtonElement>(
        "button",
        { name: /up$/ },
      ).disabled,
    ).toBe(true);

    await user.click(
      screen.getByRole("button", { name: "Remove Seated Dumbbell Press" }),
    );
    await user.click(screen.getByRole("button", { name: "Add exercise" }));
    const sheet = await screen.findByRole("dialog", {
      name: "Add an exercise",
    });
    await user.type(within(sheet).getByLabelText("Search exercises"), "hammer");
    // Mobility entries aren't offered.
    expect(
      within(sheet).queryByRole("button", { name: "Hammer Stretch" }),
    ).toBeNull();
    await user.click(
      within(sheet).getByRole("button", { name: "Hammer Curls" }),
    );
    await waitFor(async () =>
      expect(
        (await saved())?.slots.map((s) => [s.exerciseId, s.repMin, s.repMax]),
      ).toEqual([
        [bench.id, 6, 11],
        [curl.id, 8, 12],
      ]),
    );

    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Push day{Enter}");
    await user.click(screen.getByRole("radio", { name: "Key" }));
    await waitFor(async () =>
      expect(await saved()).toMatchObject({ name: "Push day", intent: "key" }),
    );
    const ops = await localDb.outbox.toArray();
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((op) => op.entity === "template")).toBe(true);
  });

  it("keeps min reps at or below max reps", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={[`/settings/templates/${pushA.id}`]}>
          <Navigation />
        </MemoryRouter>
      </ToastProvider>,
    );
    const benchCard = await screen.findByRole("region", {
      name: /Dumbbell Bench Press/,
    });
    const max = within(benchCard).getByRole("spinbutton", { name: "Max reps" });
    await user.clear(max);
    await user.type(max, "4{Enter}");
    await waitFor(async () =>
      expect((await saved())?.slots[0]).toMatchObject({ repMin: 4, repMax: 4 }),
    );
  });

  it("says so when the template doesn't exist", async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={[`/settings/templates/${newId()}`]}>
          <Navigation />
        </MemoryRouter>
      </ToastProvider>,
    );
    expect(
      await screen.findByText("This template doesn't exist."),
    ).toBeTruthy();
  });
});
