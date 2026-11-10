// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RestTimer } from "./RestTimer";

let clock = 1_000_000;
let visibility: DocumentVisibilityState = "visible";
const vibrate = vi.fn();

beforeEach(() => {
  clock = 1_000_000;
  visibility = "visible";
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  Object.defineProperty(navigator, "vibrate", {
    configurable: true,
    value: vibrate,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vibrate.mockReset();
  Reflect.deleteProperty(document, "visibilityState");
  Reflect.deleteProperty(navigator, "vibrate");
});

/** Moves the clock without running any timers, like a locked phone. */
function sleep(ms: number) {
  clock += ms;
}

function foreground() {
  visibility = "visible";
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

const rest = (secondsAgo: number, restSec = 90) => ({
  endsAt: clock - secondsAgo * 1000 + restSec * 1000,
  restSec,
});

describe("RestTimer", () => {
  it("shows the time left from the set's timestamp", () => {
    render(<RestTimer rest={rest(20)} />);
    expect(screen.getByRole("timer").textContent).toBe("1:10");
  });

  it("is right after the screen locks, with no ticks while locked", () => {
    render(<RestTimer rest={rest(0)} />);
    visibility = "hidden";
    sleep(75_000);
    foreground();
    expect(screen.getByRole("timer").textContent).toBe("0:15");

    visibility = "hidden";
    sleep(60_000);
    foreground();
    expect(screen.getByRole("status").textContent).toBe("Rest over");
    expect(screen.getByText("+0:45")).toBeTruthy();
    // It ran out while the app was in the background: no late beep.
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("cues when the rest runs out in the foreground", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      render(<RestTimer rest={rest(89)} />);
      expect(vibrate).not.toHaveBeenCalled();
      sleep(1_000);
      await act(() => vi.advanceTimersByTimeAsync(250));
      expect(screen.getByRole("status").textContent).toBe("Rest over");
      expect(vibrate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays quiet when reopened after the rest ran out", () => {
    render(<RestTimer rest={rest(120)} />);
    expect(screen.getByRole("status").textContent).toBe("Rest over");
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("hides ten minutes after the rest ran out", () => {
    render(<RestTimer rest={rest(90 + 601)} />);
    expect(screen.queryByRole("region", { name: "Rest timer" })).toBeNull();
  });
});
