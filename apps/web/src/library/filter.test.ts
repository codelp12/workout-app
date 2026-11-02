import { describe, expect, it } from "vitest";
import {
  facetOptions,
  readQuery,
  searchLibrary,
  vocabLabel,
  writeQuery,
  type LibraryQuery,
} from "./filter";
import { testExercise } from "./test-exercise";

const bench = testExercise({
  name: "Dumbbell Bench Press",
  aliases: ["DB Bench Press"],
  primaryMuscles: ["chest"],
  equipment: ["dumbbell"],
  movementPattern: "horizontal_push",
});
const pushups = testExercise({
  name: "Pushups",
  primaryMuscles: ["chest"],
  equipment: ["bodyweight"],
  movementPattern: "horizontal_push",
});
const row = testExercise({
  name: "One-Arm Dumbbell Row",
  primaryMuscles: ["middle_back"],
  equipment: ["dumbbell"],
  movementPattern: "horizontal_pull",
});
const deleted = testExercise({ name: "Bench Dips", deletedAt: 5 });
const all = [row, pushups, bench, deleted];

const q = (fields: Partial<LibraryQuery>): LibraryQuery => ({
  q: "",
  muscle: [],
  equipment: [],
  pattern: [],
  ...fields,
});
const names = (query: LibraryQuery) =>
  searchLibrary(all, query).map((e) => e.name);

describe("searchLibrary", () => {
  it("lists live exercises by name", () => {
    expect(names(q({}))).toEqual([
      "Dumbbell Bench Press",
      "One-Arm Dumbbell Row",
      "Pushups",
    ]);
  });

  it("matches every search word as a word prefix of the name or an alias", () => {
    expect(names(q({ q: "dumb" }))).toEqual([
      "Dumbbell Bench Press",
      "One-Arm Dumbbell Row",
    ]);
    expect(names(q({ q: "  Bench   dumbbell " }))).toEqual([
      "Dumbbell Bench Press",
    ]);
    expect(names(q({ q: "db press" }))).toEqual(["Dumbbell Bench Press"]);
    expect(names(q({ q: "one arm" }))).toEqual(["One-Arm Dumbbell Row"]);
    expect(names(q({ q: "ench" }))).toEqual([]);
  });

  it("ORs values within a filter and ANDs across filters", () => {
    expect(names(q({ equipment: ["dumbbell", "bodyweight"] }))).toHaveLength(3);
    expect(names(q({ muscle: ["chest"], equipment: ["dumbbell"] }))).toEqual([
      "Dumbbell Bench Press",
    ]);
    expect(names(q({ pattern: ["horizontal_pull"], q: "row" }))).toEqual([
      "One-Arm Dumbbell Row",
    ]);
  });
});

describe("facetOptions", () => {
  it("lists each value once, sorted by label", () => {
    expect(facetOptions(all, "equipment")).toEqual(["bodyweight", "dumbbell"]);
    expect(facetOptions(all, "pattern")).toEqual([
      "horizontal_pull",
      "horizontal_push",
    ]);
  });
});

describe("the URL query", () => {
  it("round-trips through search params", () => {
    const query = q({ q: "press", muscle: ["chest"], equipment: ["a", "b"] });
    const params = writeQuery(query);
    expect(params.toString()).toBe(
      "q=press&muscle=chest&equipment=a&equipment=b",
    );
    expect(readQuery(params)).toEqual(query);
    expect(writeQuery(q({})).toString()).toBe("");
  });
});

describe("vocabLabel", () => {
  it("turns snake_case into a label", () => {
    expect(vocabLabel("lower_back")).toBe("Lower back");
    expect(vocabLabel("ez_bar")).toBe("EZ bar");
  });
});
