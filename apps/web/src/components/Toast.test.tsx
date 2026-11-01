// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./Toast";
import { useToast, type ToastOptions } from "./toast-context";

// jsdom has no pointer capture, which Radix's swipe handling calls.
if (!("hasPointerCapture" in Element.prototype)) {
  Object.assign(Element.prototype, {
    hasPointerCapture: () => false,
    releasePointerCapture: () => {},
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function Raise(options: ToastOptions) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast(options)}>
      Raise
    </button>
  );
}

function renderToast(options: ToastOptions) {
  render(
    <ToastProvider>
      <Raise {...options} />
    </ToastProvider>,
  );
  return screen.getByRole("button", { name: "Raise" });
}

describe("Toast", () => {
  it("shows the title and description in a labelled region", async () => {
    const user = userEvent.setup();
    await user.click(
      renderToast({ title: "Set saved", description: "3×10 at 50 lb" }),
    );
    const region = screen.getByRole("region", { name: /notifications/i });
    expect(region.textContent).toContain("Set saved");
    expect(region.textContent).toContain("3×10 at 50 lb");
  });

  it("is announced to screen readers", async () => {
    const user = userEvent.setup();
    await user.click(renderToast({ title: "Set saved" }));
    await waitFor(() => {
      const announcer = screen
        .getAllByRole("status")
        .find((el) => el.textContent?.includes("Set saved"));
      // Radix's default "foreground" type: the result of a user action.
      expect(announcer?.getAttribute("aria-live")).toBe("assertive");
    });
  });

  it("runs the action and closes", async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    await user.click(
      renderToast({
        title: "Set skipped",
        action: { label: "Undo", altText: "Undo skip", onClick: onUndo },
      }),
    );
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(screen.queryByText("Set skipped")).toBeNull();
  });

  it("closes with the Dismiss button", async () => {
    const user = userEvent.setup();
    await user.click(renderToast({ title: "Set saved" }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Set saved")).toBeNull();
  });

  it("hides itself after its duration", () => {
    vi.useFakeTimers();
    const raise = renderToast({ title: "Set saved", duration: 1000 });
    act(() => raise.click());
    expect(screen.getByText("Set saved")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.queryByText("Set saved")).toBeNull();
  });

  it("useToast throws without a provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Raise title="x" />)).toThrow(/ToastProvider/);
  });
});
