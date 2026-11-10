import type { SetLog } from "@workout-app/shared";
import { describe, expect, it } from "vitest";
import type { LiftCard } from "./lift-log";
import { formatClock, latestRest, secondsLeft } from "./rest";

const card = (restSec: number, completedAt: number[]): LiftCard => ({
  itemId: `item-${restSec}`,
  item: { id: `item-${restSec}`, plannedSessionId: "s", exerciseId: null },
  exercise: null,
  substitutes: [],
  skipped: false,
  targets: {
    sets: 3,
    load: null,
    band: null,
    repMin: 8,
    repMax: 12,
    targetRir: 2,
    restSec,
  },
  sets: completedAt.map((at, index) => ({ index, completedAt: at }) as SetLog),
  warmups: [],
  lastTime: [],
});

describe("latestRest", () => {
  it("is null before the first set", () => {
    expect(latestRest([card(90, []), card(60, [])])).toBeNull();
  });

  it("runs from the latest set, with that exercise's rest", () => {
    expect(latestRest([card(150, [1_000, 5_000]), card(60, [3_000])])).toEqual({
      endsAt: 5_000 + 150_000,
      restSec: 150,
    });
    expect(latestRest([card(150, [1_000]), card(60, [3_000])])).toEqual({
      endsAt: 3_000 + 60_000,
      restSec: 60,
    });
  });

  it("is null when the exercise has no rest", () => {
    expect(latestRest([card(0, [1_000])])).toBeNull();
  });
});

describe("secondsLeft", () => {
  const rest = { endsAt: 100_000, restSec: 90 };

  it("rounds up, so the clock reads 0:00 only when the rest is over", () => {
    expect(secondsLeft(rest, 10_000)).toBe(90);
    expect(secondsLeft(rest, 10_001)).toBe(90);
    expect(secondsLeft(rest, 99_999)).toBe(1);
    expect(secondsLeft(rest, 100_000)).toBe(0);
  });

  it("depends only on the clock, so time spent locked still counts", () => {
    expect(secondsLeft(rest, 10_000 + 60_000)).toBe(30);
    expect(secondsLeft(rest, 10_000 + 600_000)).toBeLessThan(0);
  });
});

describe("formatClock", () => {
  it("formats minutes and seconds", () => {
    expect(formatClock(150)).toBe("2:30");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(9)).toBe("0:09");
  });
});
