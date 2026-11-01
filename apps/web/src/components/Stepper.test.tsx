// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Stepper } from "./Stepper";

afterEach(cleanup);

function Harness(props: {
  initial: number;
  step?: number;
  min?: number;
  max?: number;
  onChange?: (v: number) => void;
}) {
  const [value, setValue] = useState(props.initial);
  return (
    <Stepper
      label="Weight"
      unit="lb"
      value={value}
      step={props.step}
      min={props.min}
      max={props.max}
      onValueChange={(v) => {
        setValue(v);
        props.onChange?.(v);
      }}
    />
  );
}

describe("Stepper", () => {
  it("is a labelled spinbutton with named buttons", () => {
    render(<Harness initial={50} max={120} />);
    const input = screen.getByRole("spinbutton", { name: "Weight" });
    expect(input.getAttribute("aria-valuenow")).toBe("50");
    expect(input.getAttribute("aria-valuemin")).toBe("0");
    expect(input.getAttribute("aria-valuemax")).toBe("120");
    expect(input.getAttribute("aria-valuetext")).toBe("50 lb");
    expect(screen.getByRole("group", { name: "Weight" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Increase Weight" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Decrease Weight" }),
    ).toBeTruthy();
  });

  it("steps with the buttons and disables them at the limits", async () => {
    const user = userEvent.setup();
    render(<Harness initial={10} step={5} min={5} max={15} />);
    const input = screen.getByRole("spinbutton");
    const plus = screen.getByRole("button", { name: "Increase Weight" });
    const minus = screen.getByRole("button", { name: "Decrease Weight" });

    await user.click(plus);
    expect(input.getAttribute("aria-valuenow")).toBe("15");
    expect((plus as HTMLButtonElement).disabled).toBe(true);

    await user.click(minus);
    await user.click(minus);
    expect(input.getAttribute("aria-valuenow")).toBe("5");
    expect((minus as HTMLButtonElement).disabled).toBe(true);
  });

  it("steps with arrow keys and jumps with Home and End", async () => {
    const user = userEvent.setup();
    render(<Harness initial={20} step={2.5} min={0} max={100} />);
    const input = screen.getByRole("spinbutton");
    input.focus();

    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(input.getAttribute("aria-valuenow")).toBe("25");
    await user.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-valuenow")).toBe("22.5");
    await user.keyboard("{End}");
    expect(input.getAttribute("aria-valuenow")).toBe("100");
    await user.keyboard("{Home}");
    expect(input.getAttribute("aria-valuenow")).toBe("0");
  });

  it("avoids floating-point drift on fractional steps", async () => {
    const user = userEvent.setup();
    render(<Harness initial={0} step={0.1} />);
    const plus = screen.getByRole("button", { name: "Increase Weight" });
    for (let i = 0; i < 3; i++) await user.click(plus);
    expect(screen.getByRole<HTMLInputElement>("spinbutton").value).toBe("0.3");
  });

  it("commits a typed value on Enter, clamped to the range", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={20} max={120} onChange={onChange} />);
    const input = screen.getByRole<HTMLInputElement>("spinbutton");

    await user.click(input);
    await user.keyboard("{Control>}a{/Control}45{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(45);

    await user.keyboard("{Control>}a{/Control}500{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(120);
    expect(input.value).toBe("120");
  });

  it("commits on blur and reverts input that isn't a number", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={20} onChange={onChange} />);
    const input = screen.getByRole<HTMLInputElement>("spinbutton");

    await user.click(input);
    await user.keyboard("{Control>}a{/Control}abc");
    await user.tab();
    expect(input.value).toBe("20");
    expect(onChange).not.toHaveBeenCalled();

    await user.click(input);
    await user.keyboard("{Control>}a{/Control}32,5");
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith(32.5);
  });
});
