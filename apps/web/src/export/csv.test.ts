import "fake-indexeddb/auto";
import { newId } from "@workout-app/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { rows } from "../history/test-rows";
import { testExercise } from "../library/test-exercise";
import { openLocalDb } from "../sync/local-db";
import { climbsCsv, runsCsv, setsCsv, toCsv } from "./csv";

const db = openLocalDb("csv-test");

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("toCsv", () => {
  it("quotes commas, quotes and line breaks, and leaves nulls empty", () => {
    expect(
      toCsv(
        ["a", "b", "c"],
        [
          ["x, y", 'say "hi"', null],
          ["line\nbreak", 3, true],
        ],
      ),
    ).toBe('a,b,c\r\n"x, y","say ""hi""",\r\n"line\nbreak",3,true\r\n');
  });

  it("keeps text that looks like a formula from being run", () => {
    expect(toCsv(["a"], [["=1+1"], ["@SUM(A1)"], ["-x"], [-5]])).toBe(
      "a\r\n'=1+1\r\n'@SUM(A1)\r\n'-x\r\n-5\r\n",
    );
  });
});

describe("CSV exports", () => {
  it("lists sets oldest session first, with exercise names", async () => {
    const bench = testExercise({ name: "Dumbbell Bench Press" });
    const older = rows.log({ localDate: "2026-11-02" });
    const newer = rows.log({ localDate: "2026-11-09" });
    await db.rows("exercise").put(bench);
    await db.rows("session_log").bulkPut([newer, older]);
    await db.rows("set_log").bulkPut([
      rows.set(newer, {
        exerciseId: bench.id,
        loadValue: 65,
        completedAt: 3,
      }),
      rows.set(older, {
        exerciseId: bench.id,
        isWarmup: true,
        rir: null,
        completedAt: 1,
      }),
      rows.set(older, { exerciseId: bench.id, index: 1, completedAt: 2 }),
      rows.set(older, { exerciseId: bench.id, index: 2, deletedAt: 9 }),
    ]);
    expect((await setsCsv(db)).split("\r\n")).toEqual([
      "date,session,exercise,set,warm_up,load,unit,band,reps,rir",
      "2026-11-02,Lifting session,Dumbbell Bench Press,1,true,60,lb,,8,",
      "2026-11-02,Lifting session,Dumbbell Bench Press,2,false,60,lb,,8,2",
      "2026-11-09,Lifting session,Dumbbell Bench Press,1,false,65,lb,,8,2",
      "",
    ]);
  });

  it("lists runs and climbs", async () => {
    const run = rows.log({ modality: "run", notes: "Windy, hilly" });
    const climb = rows.log({ modality: "climb" });
    const projectId = newId();
    await db.rows("session_log").bulkPut([run, climb]);
    await db.rows("run_log").put(rows.run(run));
    await db.rows("project").put({
      id: projectId,
      userId: 1,
      createdAt: 0,
      updatedAt: 0,
      deletedAt: null,
      serverSeq: 1,
      name: "Blue arete",
      grade: "V5",
      status: "active",
      sentAt: null,
      notes: null,
    });
    await db.rows("ascent").bulkPut([
      rows.ascent(climb, { createdAt: 1 }),
      rows.ascent(climb, {
        createdAt: 2,
        grade: "V5",
        style: "attempt",
        attempts: 3,
        projectId,
        tags: ["crimp", "overhang"],
      }),
    ]);
    expect((await runsCsv(db)).split("\r\n").slice(0, 2)).toEqual([
      "date,workout,distance,unit,duration_sec,avg_hr,elevation,elevation_unit,rpe,notes",
      '2026-11-09,easy,3.1,mi,1581,,,,4,"Windy, hilly"',
    ]);
    expect((await climbsCsv(db)).split("\r\n").slice(0, 3)).toEqual([
      "date,session,grade,style,attempts,project,tags",
      "2026-11-09,Climbing session,V3,send,1,,",
      "2026-11-09,Climbing session,V5,attempt,3,Blue arete,crimp overhang",
    ]);
  });
});
