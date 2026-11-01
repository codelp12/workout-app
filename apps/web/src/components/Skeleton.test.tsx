// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Loading, Skeleton } from "./Skeleton";

afterEach(cleanup);

describe("Skeleton", () => {
  it("is hidden from screen readers and sized by its classes", () => {
    render(<Skeleton className="h-6 w-32" />);
    const block = screen.getByTestId("skeleton");
    expect(block.getAttribute("aria-hidden")).toBe("true");
    expect(block.className).toContain("h-6 w-32");
    expect(block.className).toContain("motion-reduce:animate-none");
  });

  it("Loading announces one label instead of the skeletons", () => {
    render(
      <Loading label="Loading exercises">
        <Skeleton />
        <Skeleton />
      </Loading>,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Loading exercises");
    expect(screen.getAllByTestId("skeleton")).toHaveLength(2);
  });
});
