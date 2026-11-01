// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ChipGroup } from "./ChipGroup";

afterEach(cleanup);

const rir = ["0", "1", "2", "3", "4"].map((v) => ({ value: v, label: v }));

function Single({ initial }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <ChipGroup
      type="single"
      label="Reps in reserve"
      options={rir}
      value={value}
      onValueChange={setValue}
      modality="lift"
    />
  );
}

function Multiple() {
  const [value, setValue] = useState<string[]>([]);
  return (
    <>
      <ChipGroup
        type="multiple"
        label="Modalities"
        options={[
          { value: "lift", label: "Lifting" },
          { value: "run", label: "Running" },
        ]}
        value={value}
        onValueChange={setValue}
      />
      <output>{value.join(",")}</output>
    </>
  );
}

const checked = (name: string) =>
  screen.getByRole("radio", { name }).getAttribute("aria-checked");

describe("ChipGroup", () => {
  it("single mode is a named radio group", async () => {
    const user = userEvent.setup();
    render(<Single />);
    expect(
      screen.getByRole("radiogroup", { name: "Reps in reserve" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(5);

    await user.click(screen.getByRole("radio", { name: "2" }));
    expect(checked("2")).toBe("true");
    expect(checked("1")).toBe("false");
  });

  it("keeps the selection when the selected chip is tapped again", async () => {
    const user = userEvent.setup();
    render(<Single initial="2" />);
    await user.click(screen.getByRole("radio", { name: "2" }));
    expect(checked("2")).toBe("true");
  });

  it("moves focus with arrow keys and selects with Space", async () => {
    const user = userEvent.setup();
    render(<Single initial="0" />);
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "0" }),
    );
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "2" }),
    );
    await user.keyboard(" ");
    expect(checked("2")).toBe("true");
  });

  it("colors selected chips in the modality's color", () => {
    render(<Single initial="1" />);
    expect(screen.getByRole("radio", { name: "1" }).className).toContain(
      "data-[state=on]:bg-lift",
    );
  });

  it("multiple mode toggles each chip independently", async () => {
    const user = userEvent.setup();
    render(<Multiple />);
    const lifting = screen.getByRole("button", { name: "Lifting" });
    const running = screen.getByRole("button", { name: "Running" });

    await user.click(lifting);
    await user.click(running);
    expect(lifting.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("lift,run");

    await user.click(lifting);
    expect(lifting.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("status").textContent).toBe("run");
  });
});
