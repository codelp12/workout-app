import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  isoWeekday,
  localDateAt,
  weekStartOf,
} from "./calendar.js";

describe("localDateAt", () => {
  const instant = Date.UTC(2026, 10, 2, 3, 30); // Mon 03:30 UTC
  it.each([
    ["UTC", "2026-11-02"],
    ["America/New_York", "2026-11-01"],
    ["America/Los_Angeles", "2026-11-01"],
    ["Pacific/Auckland", "2026-11-02"],
    ["Pacific/Kiritimati", "2026-11-02"],
    ["Not/A_Zone", "2026-11-02"],
  ])("%s", (zone, date) => {
    expect(localDateAt(zone, instant)).toBe(date);
  });

  it("follows daylight saving in New York", () => {
    // Fall back on Sun 2026-11-01: midnight Monday is 05:00 UTC, not 04:00.
    expect(localDateAt("America/New_York", Date.UTC(2026, 10, 2, 4, 59))).toBe(
      "2026-11-01",
    );
    expect(localDateAt("America/New_York", Date.UTC(2026, 10, 2, 5))).toBe(
      "2026-11-02",
    );
    // Spring forward on Sun 2027-03-14: midnight Monday is 04:00 UTC.
    expect(localDateAt("America/New_York", Date.UTC(2027, 2, 15, 3, 59))).toBe(
      "2027-03-14",
    );
    expect(localDateAt("America/New_York", Date.UTC(2027, 2, 15, 4))).toBe(
      "2027-03-15",
    );
  });
});

describe("date arithmetic", () => {
  it("counts days across DST and year ends", () => {
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(daysBetween("2026-10-26", "2026-11-02")).toBe(7);
    expect(daysBetween("2027-03-15", "2027-03-08")).toBe(-7);
  });

  it("finds the Monday each week starts on", () => {
    expect(isoWeekday("2026-11-02")).toBe(1);
    expect(isoWeekday("2026-11-08")).toBe(7);
    expect(weekStartOf("2026-11-08")).toBe("2026-11-02");
    expect(weekStartOf("2026-11-02")).toBe("2026-11-02");
    expect(weekStartOf("2027-01-02")).toBe("2026-12-28");
  });
});
