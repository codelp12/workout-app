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
import { MAIN_LIFTS, SETTINGS_ID } from "@workout-app/shared";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ToastProvider } from "../components/Toast";
import { Navigation } from "../Navigation";
import { onboardingOffered } from "../settings/onboarding-flag";
import { localDb } from "../sync";

beforeAll(() => {
  window.scrollTo = () => {};
  if (!("hasPointerCapture" in Element.prototype))
    Object.assign(Element.prototype, {
      hasPointerCapture: () => false,
      releasePointerCapture: () => {},
    });
});

beforeEach(async () => {
  localStorage.clear();
  await Promise.all(
    [localDb.rows("settings"), localDb.outbox].map((t) => t.clear()),
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

const saved = () => localDb.rows("settings").get(SETTINGS_ID);
const next = () => screen.getByRole("button", { name: "Next" });
const radio = (group: string, name: string) =>
  within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", {
    name,
  });

describe("Onboarding", () => {
  it("walks through equipment, lifts, a run and grades, then saves", async () => {
    const user = userEvent.setup();
    renderAt("/onboarding");

    expect(await screen.findByText("Step 1 of 4: Equipment")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Remove 110 lb barbell" }),
    );
    await user.click(next());

    expect(screen.getByText("Step 2 of 4: Lifts")).toBeTruthy();
    await user.click(
      screen.getByRole("button", {
        name: "I know my dumbbell bench press weight",
      }),
    );
    const weight = screen.getByRole("spinbutton", {
      name: "Dumbbell bench press weight",
    });
    await user.clear(weight);
    await user.type(weight, "62{Enter}");
    await user.click(
      screen.getByRole("button", {
        name: "Increase Dumbbell bench press reps",
      }),
    );
    await user.click(radio("Dumbbell bench press reps in reserve", "1"));
    await user.click(next());

    expect(screen.getByText("Step 3 of 4: Running")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add a recent run" }));
    await user.click(screen.getByRole("button", { name: "Increase Minutes" }));
    await user.click(radio("Run effort (RPE)", "9"));
    await user.click(next());

    expect(screen.getByText("Step 4 of 4: Climbing")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "I climb" }));
    await user.click(radio("Limit grade", "V6"));
    await user.click(radio("Volume grade", "V4"));
    await user.click(screen.getByRole("button", { name: "Finish" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Today" }),
    ).toBeTruthy();
    const row = await saved();
    expect(row?.equipment.barbells).not.toContain(110);
    const bench = MAIN_LIFTS.find((l) => l.sourceId === "Dumbbell_Bench_Press");
    expect(row?.onboarding).toMatchObject({
      // 62 lb isn't on the rack, so it rounds to the nearest dumbbell.
      lifts: [
        {
          exerciseId: bench?.exerciseId,
          load: { value: 60, unit: "lb" },
          reps: 9,
          rir: 1,
        },
      ],
      run: {
        distanceValue: 3.1,
        distanceUnit: "mi",
        durationSec: 26 * 60,
        rpe: 9,
        weeklyDistance: 10,
      },
      climb: { discipline: "boulder", limitGrade: "V6", volumeGrade: "V4" },
    });
    expect(row?.onboarding?.completedAt).toBeGreaterThan(0);
    expect(onboardingOffered()).toBe(true);
  });

  it("skipping saves nothing but doesn't ask again on this device", async () => {
    const user = userEvent.setup();
    renderAt("/onboarding");
    await user.click(
      await screen.findByRole("button", { name: "Skip for now" }),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Today" }),
    ).toBeTruthy();
    expect(await saved()).toBeUndefined();
    expect(onboardingOffered()).toBe(true);
  });

  it("re-runs from Settings with the saved answers", async () => {
    const user = userEvent.setup();
    renderAt("/onboarding");
    await user.click(await screen.findByRole("button", { name: "Next" }));
    await user.click(next());
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "I climb" }));
    await user.click(radio("Discipline", "Routes"));
    await user.click(radio("Limit grade", "5.12a"));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByRole("heading", { level: 1, name: "Today" });
    cleanup();

    renderAt("/settings");
    await user.click(
      await screen.findByRole("link", { name: "Run setup again" }),
    );
    await user.click(await screen.findByRole("button", { name: "Next" }));
    await user.click(next());
    await user.click(next());
    expect(radio("Discipline", "Routes").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(radio("Limit grade", "5.12a").getAttribute("aria-checked")).toBe(
      "true",
    );
    await waitFor(async () =>
      expect((await saved())?.onboarding?.lifts).toEqual([]),
    );
  });
});
