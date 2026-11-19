// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTextEntry, useTabBarPlacement } from "./tab-bar-placement";

class FakeViewport extends EventTarget {
  offsetTop = 0;
  height = 800;
}

let vv: FakeViewport;

beforeEach(() => {
  vi.useFakeTimers();
  vv = new FakeViewport();
  Object.defineProperty(window, "visualViewport", {
    value: vv,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: 800,
    configurable: true,
  });
  window.scrollBy = () => {};
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Probe() {
  const { hidden, offset } = useTabBarPlacement();
  return (
    <>
      <input aria-label="Reps" />
      <button type="button">Log set</button>
      <output aria-label="Placement">{`${hidden} ${offset}`}</output>
    </>
  );
}

const placement = () => screen.getByLabelText("Placement").textContent;

describe("useTabBarPlacement", () => {
  const resize = (height: number) => {
    vv.height = height;
    vv.dispatchEvent(new Event("resize"));
  };

  it("hides the bar while the keyboard is up and shows it after", () => {
    render(<Probe />);
    act(() => screen.getByLabelText("Reps").focus());
    expect(placement()).toBe("false 0");
    act(() => resize(450));
    expect(placement()).toBe("true 0");
    act(() => {
      screen.getByRole("button").focus();
      resize(800);
      vi.runAllTimers();
    });
    expect(placement()).toBe("false 0");
  });

  it("keeps the bar when a text field has focus but no keyboard shows (desktop)", () => {
    render(<Probe />);
    act(() => screen.getByLabelText("Reps").focus());
    act(() => resize(780));
    expect(placement()).toBe("false 0");
  });

  it("moves the bar down when the viewport stays shifted after the keyboard closes", () => {
    render(<Probe />);
    act(() => {
      vv.offsetTop = 24;
      vv.dispatchEvent(new Event("scroll"));
    });
    expect(placement()).toBe("false 24");
    act(() => {
      vv.offsetTop = 0;
      vv.dispatchEvent(new Event("scroll"));
    });
    expect(placement()).toBe("false 0");
  });

  it("leaves the bar alone when zoomed in (the viewport sits inside the page)", () => {
    render(<Probe />);
    act(() => {
      vv.offsetTop = 100;
      resize(400);
    });
    expect(placement()).toBe("false 0");
  });
});

describe("isTextEntry", () => {
  it("counts fields that bring up the keyboard", () => {
    const el = (html: string) => {
      document.body.innerHTML = html;
      return document.body.firstElementChild;
    };
    expect(isTextEntry(el('<input type="text">'))).toBe(true);
    expect(isTextEntry(el('<input inputmode="numeric">'))).toBe(true);
    expect(isTextEntry(el("<textarea></textarea>"))).toBe(true);
    expect(isTextEntry(el('<input type="checkbox">'))).toBe(false);
    expect(isTextEntry(el("<button></button>"))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});
