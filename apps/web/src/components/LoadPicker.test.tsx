// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { LoadPicker } from "./LoadPicker";

afterEach(cleanup);

const options = [20, 30, 40, 50, 60];

function Harness({ initial }: { initial: number }) {
  const [value, setValue] = useState(initial);
  return (
    <LoadPicker
      label="Weight"
      unit="lb"
      value={value}
      options={options}
      onValueChange={setValue}
    />
  );
}

const current = () =>
  screen.getByRole("button", { name: /^Weight: / }).textContent;

describe("LoadPicker", () => {
  it("steps to the neighbouring loads and stops at the ends", async () => {
    const user = userEvent.setup();
    render(<Harness initial={50} />);
    const up = screen.getByRole("button", { name: "Increase Weight" });
    const down = screen.getByRole("button", { name: "Decrease Weight" });
    await user.click(up);
    expect(current()).toBe("60 lb");
    expect((up as HTMLButtonElement).disabled).toBe(true);
    for (let i = 0; i < 4; i++) await user.click(down);
    expect(current()).toBe("20 lb");
    expect((down as HTMLButtonElement).disabled).toBe(true);
  });

  it("lists only the options in a sheet and picks one", async () => {
    const user = userEvent.setup();
    render(<Harness initial={40} />);
    await user.click(screen.getByRole("button", { name: "Weight: 40 lb" }));
    const sheet = await screen.findByRole("dialog", { name: "Pick a weight" });
    const list = within(sheet).getByRole("list", { name: "Weight options" });
    const choices = within(list).getAllByRole("button");
    expect(choices.map((b) => b.textContent)).toEqual([
      "20 lb",
      "30 lb",
      "40 lb",
      "50 lb",
      "60 lb",
    ]);
    expect(
      within(list)
        .getByRole("button", { name: "40 lb" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await user.click(within(list).getByRole("button", { name: "30 lb" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(current()).toBe("30 lb");
  });

  it("has no text field to type an unlisted weight into", () => {
    render(<Harness initial={40} />);
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
