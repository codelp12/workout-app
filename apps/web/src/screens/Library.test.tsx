// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ToastProvider } from "../components/Toast";
import { testExercise } from "../library/test-exercise";
import { Navigation } from "../Navigation";
import { localDb } from "../sync";

beforeAll(() => {
  window.scrollTo = () => {};
  // jsdom has no pointer capture, which Radix's toast swipe handling calls.
  if (!("hasPointerCapture" in Element.prototype))
    Object.assign(Element.prototype, {
      hasPointerCapture: () => false,
      releasePointerCapture: () => {},
    });
});

const bench = testExercise({
  name: "Dumbbell Bench Press",
  primaryMuscles: ["chest"],
  secondaryMuscles: ["triceps"],
  equipment: ["dumbbell"],
  movementPattern: "horizontal_push",
  instructions: ["Lie on the bench.", "Press the dumbbells up."],
  media: [
    {
      kind: "image",
      path: "Dumbbell_Bench_Press/0.webp",
      source: "free-exercise-db@abc",
      license: "Unlicense",
    },
  ],
});
const pushups = testExercise({
  name: "Pushups",
  primaryMuscles: ["chest"],
  equipment: ["bodyweight"],
});
const curl = testExercise({
  name: "Hammer Curl",
  primaryMuscles: ["biceps"],
  equipment: ["dumbbell"],
});

beforeEach(async () => {
  await Promise.all(
    [localDb.rows("exercise"), localDb.outbox].map((t) => t.clear()),
  );
});
afterEach(cleanup);

function renderAt(path: string) {
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Navigation />
      </MemoryRouter>
    </ToastProvider>,
  );
}

const list = () => screen.getByRole("list", { name: "Exercises" });
const listed = () =>
  within(list())
    .getAllByRole("link")
    .map((a) => a.textContent);

describe("Library", () => {
  it("says the library comes with the first sync when it's empty", async () => {
    renderAt("/library");
    expect(
      await screen.findByText(/downloads the first time you sync/),
    ).toBeTruthy();
  });

  it("searches and filters", async () => {
    await localDb.rows("exercise").bulkPut([bench, pushups, curl]);
    const user = userEvent.setup();
    renderAt("/library");
    await screen.findByRole("list", { name: "Exercises" });
    expect(screen.getByRole("status").textContent).toBe("3 exercises");

    await user.type(screen.getByLabelText("Search exercises"), "dumbbell");
    expect(listed()).toEqual(["Dumbbell Bench PressChest · Dumbbell"]);
    await user.clear(screen.getByLabelText("Search exercises"));

    await user.click(screen.getByRole("button", { name: "Filters" }));
    const dialog = await screen.findByRole("dialog", { name: "Filters" });
    await user.click(within(dialog).getByRole("button", { name: "Chest" }));
    await user.click(within(dialog).getByRole("button", { name: "Dumbbell" }));
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(screen.getByRole("button", { name: "Filters (2)" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("1 exercise");
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("status").textContent).toBe("3 exercises");
  });

  it("opens an exercise and saves personal notes to the outbox", async () => {
    await localDb.rows("exercise").bulkPut([bench, pushups]);
    const user = userEvent.setup();
    renderAt("/library");
    await user.click(
      await screen.findByRole("link", { name: /Dumbbell Bench Press/ }),
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Dumbbell Bench Press",
      }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("img", { name: "Dumbbell Bench Press, photo 1 of 1" })
        .getAttribute("src"),
    ).toBe("/media/exercises/Dumbbell_Bench_Press/0.webp");
    const steps = screen.getByRole("region", { name: "Instructions" });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("region", { name: "Cues" })).toBeNull();
    expect(
      screen
        .getByRole("navigation", { name: "Tabs" })
        .querySelector('[aria-current="page"]')?.textContent,
    ).toBe("Library");

    const save = screen.getByRole("button", { name: "Save notes" });
    expect(save.hasAttribute("disabled")).toBe(true);
    await user.type(
      screen.getByLabelText("Personal notes"),
      "  Bench by the window  ",
    );
    await user.click(save);
    expect(await screen.findByText("Notes saved")).toBeTruthy();

    expect((await localDb.rows("exercise").get(bench.id))?.notes).toBe(
      "Bench by the window",
    );
    const [op] = await localDb.outbox.toArray();
    expect(op).toMatchObject({
      entity: "exercise",
      action: "upsert",
      rowId: bench.id,
      data: { id: bench.id, notes: "Bench by the window" },
    });

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("list", { name: "Exercises" })).toBeTruthy();
  });

  it("shows a not-found page for an unknown exercise", async () => {
    renderAt(`/library/${bench.id}`);
    expect(
      await screen.findByRole("heading", { name: "Exercise not found" }),
    ).toBeTruthy();
  });
});
