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
import { SETTINGS_ID } from "@workout-app/shared";
import { MemoryRouter } from "react-router";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ToastProvider } from "../components/Toast";
import { Navigation } from "../Navigation";
import { localDb } from "../sync";
import { UpdateContext, type AppUpdate } from "../update/update-context";

beforeAll(() => {
  window.scrollTo = () => {};
  if (!("hasPointerCapture" in Element.prototype))
    Object.assign(Element.prototype, {
      hasPointerCapture: () => false,
      releasePointerCapture: () => {},
    });
});

beforeEach(async () => {
  await Promise.all(
    [localDb.rows("settings"), localDb.outbox].map((t) => t.clear()),
  );
});
afterEach(cleanup);

function renderSettings(update?: AppUpdate) {
  const page = (
    <ToastProvider>
      <MemoryRouter initialEntries={["/settings"]}>
        <Navigation />
      </MemoryRouter>
    </ToastProvider>
  );
  render(
    update ? (
      <UpdateContext.Provider value={update}>{page}</UpdateContext.Provider>
    ) : (
      page
    ),
  );
}

const saved = () => localDb.rows("settings").get(SETTINGS_ID);
const chip = (group: string, name: string) =>
  within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", {
    name,
  });

describe("Settings", () => {
  it("shows the SPEC §2 defaults without saving anything", async () => {
    renderSettings();
    expect(
      await screen.findByText(
        "24 weights: 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120 lb",
      ),
    ).toBeTruthy();
    expect(chip("Weight unit", "lb").getAttribute("aria-checked")).toBe("true");
    expect(chip("Distance unit", "Miles").getAttribute("aria-checked")).toBe(
      "true",
    );
    const barbells = screen.getByRole("list", { name: "Fixed barbells" });
    expect(within(barbells).getAllByRole("button")).toHaveLength(10);
    const bands = screen.getByRole("list", { name: "Bands" });
    expect(
      within(bands)
        .getAllByRole("listitem")
        .map((li) => li.firstChild?.textContent),
    ).toEqual(["Light", "Medium", "Heavy", "Extra heavy"]);
    expect(screen.getByRole("button", { name: "Monday AM" }).ariaPressed).toBe(
      "true",
    );
    expect(chip("Lift-free day", "Any").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(await saved()).toBeUndefined();
    expect(await localDb.outbox.count()).toBe(0);
  });

  it("saves each change to the settings row and the outbox", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole("radio", { name: "kg" }));
    await waitFor(async () => expect((await saved())?.weightUnit).toBe("kg"));

    await user.click(
      screen.getByRole("button", { name: "Increase Heaviest dumbbell" }),
    );
    await user.click(screen.getByRole("button", { name: "Sunday PM" }));
    await user.click(chip("Lift-free day", "Wed"));
    await user.click(chip("Long-run day", "Sat"));

    await waitFor(async () => {
      const row = await saved();
      expect(row?.equipment.dumbbells).toEqual({ min: 5, max: 125, step: 5 });
      expect(row?.availability.find((d) => d.weekday === 7)).toEqual({
        weekday: 7,
        am: true,
        pm: false,
        gym: true,
      });
      expect(row?.liftFreeDay).toBe(3);
      expect(row?.longRunDay).toBe(6);
      expect(row?.weightUnit).toBe("kg");
    });
    const ops = await localDb.outbox.toArray();
    expect(ops).toHaveLength(5);
    expect(
      ops.every((op) => op.entity === "settings" && op.rowId === SETTINGS_ID),
    ).toBe(true);
  });

  it("edits fixed barbells and bands", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(
      await screen.findByRole("button", { name: "Remove 110 lb barbell" }),
    );
    await user.type(screen.getByLabelText("Barbell weight (lb)"), "15");
    await user.click(screen.getByRole("button", { name: "Add barbell" }));

    await user.click(screen.getByRole("button", { name: "Remove Light band" }));
    await user.type(screen.getByLabelText("Band name"), "Mini");
    await user.click(screen.getByRole("button", { name: "Add band" }));
    await user.click(
      await screen.findByRole("button", { name: "Move Mini lighter" }),
    );

    await waitFor(async () => {
      const row = await saved();
      expect(row?.equipment.barbells).toEqual([
        15, 20, 30, 40, 50, 60, 70, 80, 90, 100,
      ]);
      expect(row?.equipment.bands).toEqual([
        "Medium",
        "Heavy",
        "Mini",
        "Extra heavy",
      ]);
    });
  });

  it("turns dumbbells off and back on", async () => {
    const user = userEvent.setup();
    renderSettings();
    const owned = await screen.findByRole("button", {
      name: "I have dumbbells",
    });
    await user.click(owned);
    await waitFor(async () =>
      expect((await saved())?.equipment.dumbbells).toBeNull(),
    );
    expect(screen.queryByText(/weights:/)).toBeNull();
    await user.click(owned);
    expect(await screen.findByText(/^24 weights:/)).toBeTruthy();
  });
});

describe("App updates", () => {
  const updates = () =>
    within(screen.getByRole("region", { name: "App updates" }));

  it("can't reload until an update is waiting", () => {
    const check = vi.fn();
    renderSettings({ status: "current", check, install: vi.fn() });
    expect(updates().getByText("You're on the latest version.")).toBeTruthy();
    expect(
      updates().getByRole<HTMLButtonElement>("button", {
        name: "Reload to update",
      }).disabled,
    ).toBe(true);
    expect(screen.getByRole("link", { name: "Settings" }).textContent).toBe(
      "Settings",
    );
  });

  it("checks for updates on tap", async () => {
    const check = vi.fn();
    renderSettings({ status: "idle", check, install: vi.fn() });
    await userEvent
      .setup()
      .click(updates().getByRole("button", { name: "Check for updates" }));
    expect(check).toHaveBeenCalledOnce();
  });

  it("disables checking while a check runs", () => {
    renderSettings({ status: "checking", check: vi.fn(), install: vi.fn() });
    expect(
      updates().getByRole<HTMLButtonElement>("button", {
        name: "Check for updates",
      }).disabled,
    ).toBe(true);
  });

  it("installs a waiting update and marks the Settings tab", async () => {
    const install = vi.fn();
    renderSettings({ status: "available", check: vi.fn(), install });
    expect(
      screen.getByRole("link", { name: "Settings, update available" }),
    ).toBeTruthy();
    await userEvent
      .setup()
      .click(updates().getByRole("button", { name: "Reload to update" }));
    expect(install).toHaveBeenCalledOnce();
  });

  it("explains when there's no service worker", () => {
    renderSettings();
    expect(
      updates().getByText("Updates aren't available in this browser."),
    ).toBeTruthy();
    expect(
      updates().getByRole<HTMLButtonElement>("button", {
        name: "Check for updates",
      }).disabled,
    ).toBe(true);
  });
});
