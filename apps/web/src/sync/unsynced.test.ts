import "fake-indexeddb/auto";
import { newId, unsyncedExportSchema } from "@workout-app/shared";
import { describe, expect, it } from "vitest";
import { device, fakeServer, project } from "./test-helpers";
import {
  exportFileName,
  exportUnsynced,
  ImportError,
  importUnsynced,
  unsyncedSummary,
} from "./unsynced";
import { deleteRow, saveRow } from "./writes";

const sessionLog = (id = newId()) => ({
  id,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  plannedSessionId: null,
  modality: "lift" as const,
  startedAt: 1,
  endedAt: null,
  localDate: "2026-11-01",
  timezone: "America/New_York",
  rpe: null,
  notes: null,
});

const setLog = (sessionLogId: string, index: number) => ({
  id: newId(),
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  sessionLogId,
  exerciseId: newId(),
  index,
  loadValue: 50,
  loadUnit: "lb" as const,
  band: null,
  reps: 8,
  rir: 2,
  isWarmup: false,
  completedAt: 1,
});

/** JSON round trip, as the file is written and read back. */
const asFile = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("unsyncedSummary", () => {
  it("counts each session once across its log and sets", async () => {
    const server = fakeServer();
    server.mode = "down";
    const { db, engine } = device(server);
    const a = sessionLog();
    await saveRow(db, "session_log", a);
    await saveRow(db, "set_log", setLog(a.id, 0));
    const set = setLog(a.id, 1);
    await saveRow(db, "set_log", set);
    // A set counts its session even when the session row itself has synced.
    const b = sessionLog();
    const bSet = setLog(b.id, 0);
    await saveRow(db, "set_log", bSet);
    await saveRow(db, "project", project("Not a session"));
    expect(await unsyncedSummary(db)).toEqual({
      sessions: 2,
      pending: 5,
      rejected: 0,
    });

    server.mode = "up";
    await engine.sync();
    await deleteRow(db, "set_log", set.id);
    expect(await unsyncedSummary(db)).toEqual({
      sessions: 1,
      pending: 1,
      rejected: 0,
    });
  });

  it("counts rejected ops", async () => {
    const server = fakeServer();
    const { db, engine } = device(server);
    await saveRow(db, "project", project("bad"));
    await engine.sync();
    expect(await unsyncedSummary(db)).toEqual({
      sessions: 0,
      pending: 0,
      rejected: 1,
    });
  });
});

describe("export and import", () => {
  it("exports queued and rejected ops in a file the schema accepts", async () => {
    const server = fakeServer();
    const { db, engine } = device(server);
    await saveRow(db, "project", project("bad"));
    await engine.sync();
    server.mode = "down";
    const s = sessionLog();
    await saveRow(db, "session_log", s);
    await saveRow(db, "set_log", setLog(s.id, 0));

    const file = asFile(await exportUnsynced(db, 5000));
    const parsed = unsyncedExportSchema.parse(file);
    expect(parsed.exportedAt).toBe(5000);
    expect(parsed.ops.map((op) => op.entity)).toEqual([
      "session_log",
      "set_log",
    ]);
    expect(parsed.ops.map((op) => op.opId)).toEqual(
      (await db.outbox.orderBy("seq").toArray()).map((e) => e.opId),
    );
    expect(parsed.rejected).toHaveLength(1);
    expect(parsed.rejected[0]).toMatchObject({ error: "bad name" });
  });

  it("restores a file on another device, and the server applies each op once", async () => {
    const server = fakeServer();
    const phone = device(server);
    const laptop = device(server);
    server.mode = "down";
    const kept = project("Kept");
    await saveRow(phone.db, "project", kept);
    const gone = project("Gone");
    await saveRow(phone.db, "project", gone);
    await deleteRow(phone.db, "project", gone.id);
    const file = asFile(await exportUnsynced(phone.db));

    expect(await importUnsynced(laptop.db, file)).toEqual({
      queued: 3,
      skipped: 0,
    });
    expect((await laptop.db.rows("project").get(kept.id))?.name).toBe("Kept");
    expect((await laptop.db.rows("project").get(gone.id))?.deletedAt).not.toBe(
      null,
    );
    // Importing twice queues nothing new.
    expect(await importUnsynced(laptop.db, file)).toEqual({
      queued: 0,
      skipped: 3,
    });

    server.mode = "up";
    await laptop.engine.sync();
    expect(await laptop.db.outbox.count()).toBe(0);
    expect(server.rows.size).toBe(2);
    expect(server.rows.get(gone.id)?.row.deletedAt).not.toBe(null);

    // The phone's own outbox pushes the same ops later: duplicates, no new rows.
    const seq = server.rows.get(kept.id)?.row.serverSeq;
    await phone.engine.sync();
    expect(await phone.db.outbox.count()).toBe(0);
    expect(server.rows.get(kept.id)?.row.serverSeq).toBe(seq);
  });

  it("doesn't overwrite a row the device already has", async () => {
    const server = fakeServer();
    server.mode = "down";
    const { db } = device(server);
    const p = project("Old");
    await saveRow(db, "project", p);
    const file = asFile(await exportUnsynced(db));
    await db.outbox.clear();
    await saveRow(db, "project", { ...p, name: "Newer", updatedAt: 2000 });

    expect(await importUnsynced(db, file)).toEqual({ queued: 1, skipped: 0 });
    expect((await db.rows("project").get(p.id))?.name).toBe("Newer");
  });

  it("rejects a file that isn't an export", async () => {
    const { db } = device(fakeServer());
    await expect(importUnsynced(db, { ops: [] })).rejects.toBeInstanceOf(
      ImportError,
    );
    expect(await db.outbox.count()).toBe(0);
  });

  it("names the file after the export time", () => {
    expect(exportFileName(Date.UTC(2026, 10, 1, 15, 4, 5, 6))).toBe(
      "workout-app-unsynced-2026-11-01T15-04-05-006Z.json",
    );
  });
});
