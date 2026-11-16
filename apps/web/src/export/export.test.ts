import "fake-indexeddb/auto";
import { DATA_EXPORT_FORMAT } from "@workout-app/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { rows } from "../history/test-rows";
import { testExercise } from "../library/test-exercise";
import { openLocalDb } from "../sync/local-db";
import { DataImportError, exportData, importData } from "./export";

const source = openLocalDb("export-source");
const target = openLocalDb("export-target");

const lift = rows.log();
const run = rows.log({ modality: "run" });
const bench = testExercise({ name: "Dumbbell Bench Press" });

beforeEach(async () => {
  for (const db of [source, target]) {
    await Promise.all(db.tables.map((t) => t.clear()));
  }
  await source.rows("exercise").put(bench);
  await source.rows("session_log").bulkPut([lift, run]);
  await source
    .rows("set_log")
    .bulkPut([
      rows.set(lift, { exerciseId: bench.id }),
      rows.set(lift, { exerciseId: bench.id, index: 1, deletedAt: 5 }),
    ]);
  await source.rows("run_log").put(rows.run(run));
});

describe("exportData", () => {
  it("has every entity's live rows", async () => {
    const data = await exportData(source, 1_000);
    expect(data).toMatchObject({
      format: DATA_EXPORT_FORMAT,
      version: 1,
      exportedAt: 1_000,
    });
    expect(data.entities.session_log).toHaveLength(2);
    expect(data.entities.set_log).toHaveLength(1);
    expect(data.entities.run_log).toHaveLength(1);
    expect(data.entities.block).toEqual([]);
  });

  it("round-trips: a JSON export re-imports to the same data", async () => {
    const file = JSON.parse(
      JSON.stringify(await exportData(source, 1_000)),
    ) as unknown;
    expect(await importData(target, file)).toEqual({ written: 5, kept: 0 });
    expect(await exportData(target, 1_000)).toEqual(
      await exportData(source, 1_000),
    );
    expect(await target.outbox.count()).toBe(0);
    expect(await importData(target, file)).toEqual({ written: 0, kept: 5 });
  });

  it("keeps a row the device has that's newer than the file's", async () => {
    const file = await exportData(source, 1_000);
    const newer = { ...lift, notes: "Edited later", updatedAt: 10 };
    await target.rows("session_log").put(newer);
    await importData(target, file);
    expect(await target.rows("session_log").get(lift.id)).toEqual(newer);
  });

  it("rejects a file that isn't an export", async () => {
    await expect(importData(target, { format: "nope" })).rejects.toThrow(
      DataImportError,
    );
    const data = await exportData(source, 1_000);
    const bad = {
      ...data,
      entities: { ...data.entities, set_log: [{ id: "x" }] },
    };
    await expect(importData(target, bad)).rejects.toThrow(DataImportError);
  });
});
