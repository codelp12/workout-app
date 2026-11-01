// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { BottomSheet } from "./BottomSheet";

afterEach(cleanup);

function Sheet() {
  return (
    <BottomSheet
      title="How to"
      description="Dumbbell bench press"
      trigger={<button type="button">Open how-to</button>}
    >
      <button type="button">Got it</button>
    </BottomSheet>
  );
}

describe("BottomSheet", () => {
  it("opens as a named, described modal dialog", async () => {
    const user = userEvent.setup();
    render(<Sheet />);
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open how-to" }));
    const dialog = screen.getByRole("dialog", { name: "How to" });
    expect(dialog.getAttribute("aria-describedby")).toBe(
      screen.getByText("Dumbbell bench press").id,
    );
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Sheet />);
    const trigger = screen.getByRole("button", { name: "Open how-to" });
    await user.click(trigger);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes with the Close button", async () => {
    const user = userEvent.setup();
    render(<Sheet />);
    await user.click(screen.getByRole("button", { name: "Open how-to" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("traps focus inside while open", async () => {
    const user = userEvent.setup();
    render(<Sheet />);
    await user.click(screen.getByRole("button", { name: "Open how-to" }));
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 4; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("works controlled, without a trigger or description", () => {
    render(
      <BottomSheet title="Why this target?" open onOpenChange={() => {}}>
        <p>Last time 3×10 at RIR 2.</p>
      </BottomSheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Why this target?" });
    expect(dialog.hasAttribute("aria-describedby")).toBe(false);
  });
});
