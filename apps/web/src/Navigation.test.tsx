// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ToastProvider } from "./components/Toast";
import { Navigation } from "./Navigation";

beforeAll(() => {
  // jsdom doesn't implement scrolling.
  window.scrollTo = () => {};
});
afterEach(cleanup);

const tabs = [
  ["/", "Today"],
  ["/week", "Week"],
  ["/log", "Log"],
  ["/library", "Library"],
  ["/settings", "Settings"],
] as const;

function renderAt(path: string) {
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Navigation header={<p>Header</p>} />
      </MemoryRouter>
    </ToastProvider>,
  );
}

const currentTab = () =>
  screen
    .getByRole("navigation", { name: "Tabs" })
    .querySelector('[aria-current="page"]')?.textContent;

describe("Navigation", () => {
  it("shows five named tabs in a navigation landmark", () => {
    renderAt("/");
    const nav = screen.getByRole("navigation", { name: "Tabs" });
    const links = [...nav.querySelectorAll("a")];
    expect(links.map((a) => [a.getAttribute("href"), a.textContent])).toEqual(
      tabs,
    );
  });

  it.each(tabs)("a deep link to %s opens %s", (path, title) => {
    renderAt(path);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeTruthy();
    expect(currentTab()).toBe(title);
    expect(document.title).toBe(`${title} · Workout`);
    expect(screen.getByRole("main").textContent).toContain("Header");
  });

  it("switches screens when a tab is tapped", async () => {
    const user = userEvent.setup();
    renderAt("/");
    await user.click(screen.getByRole("link", { name: "Library" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "Library" }),
    ).toBeTruthy();
    expect(currentTab()).toBe("Library");
    expect(screen.queryByRole("heading", { name: "Today" })).toBeNull();
  });

  it("sends unknown paths to Today", () => {
    renderAt("/nope");
    expect(
      screen.getByRole("heading", { level: 1, name: "Today" }),
    ).toBeTruthy();
    expect(currentTab()).toBe("Today");
  });
});
