import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { chipLabel } from "./engine";
import { device, fakeServer, project } from "./test-helpers";
import { deleteRow, saveRow } from "./writes";

describe("SyncEngine", () => {
  it("saves locally and keeps the op queued while offline", async () => {
    const server = fakeServer();
    server.mode = "down";
    const { db, engine } = device(server);
    const p = project("Offline");
    await saveRow(db, "project", p);
    expect(await db.rows("project").get(p.id)).toMatchObject({
      name: "Offline",
      serverSeq: 0,
    });
    await engine.sync();
    expect(engine.getState()).toBe("offline");
    expect(await db.outbox.count()).toBe(1);

    server.mode = "up";
    await engine.sync();
    expect(engine.getState()).toBe("idle");
    expect(await db.outbox.count()).toBe(0);
    expect(server.rows.size).toBe(1);
    expect((await db.rows("project").get(p.id))?.serverSeq).toBe(1);
  });

  it("retries a push whose response was lost without duplicating it", async () => {
    const server = fakeServer();
    const { db, engine } = device(server);
    await saveRow(db, "project", project("Once"));
    server.mode = "lose-response";
    await engine.sync();
    expect(await db.outbox.count()).toBe(1);
    server.mode = "up";
    await engine.sync();
    expect(await db.outbox.count()).toBe(0);
    expect(server.rows.size).toBe(1);
  });

  it("keeps the outbox on a 401 and syncs after signing in", async () => {
    const server = fakeServer();
    server.mode = "401";
    const { db, engine } = device(server);
    await saveRow(db, "project", project("Queued"));
    await engine.sync();
    expect(engine.getState()).toBe("signed-out");
    expect(await db.outbox.count()).toBe(1);
    server.mode = "up";
    await engine.sync();
    expect(await db.outbox.count()).toBe(0);
  });

  it("moves rejected ops out of the outbox but keeps them", async () => {
    const server = fakeServer();
    const { db, engine } = device(server);
    await saveRow(db, "project", project("bad"));
    await saveRow(db, "project", project("good"));
    await engine.sync();
    expect(await db.outbox.count()).toBe(0);
    const rejected = await db.rejected.toArray();
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ error: "bad name" });
    expect(server.rows.size).toBe(1);
  });

  it("brings another device's writes and deletes down, across pages", async () => {
    const server = fakeServer();
    const phone = device(server);
    const laptop = device(server);
    const ps = ["a", "b", "c", "d", "e"].map((n) => project(n));
    for (const p of ps) await saveRow(phone.db, "project", p);
    await phone.engine.sync();

    await laptop.engine.sync();
    expect(await laptop.db.rows("project").count()).toBe(5);
    expect((await laptop.db.meta.get("cursor"))?.value).toBe(5);

    await deleteRow(phone.db, "project", ps[0]!.id, 2000);
    await phone.engine.sync();
    await laptop.engine.sync();
    expect((await laptop.db.rows("project").get(ps[0]!.id))?.deletedAt).toBe(
      2000,
    );
  });

  it("doesn't let a pull overwrite a row with a queued local edit", async () => {
    const server = fakeServer();
    const phone = device(server);
    const laptop = device(server);
    const p = project("Original");
    await saveRow(phone.db, "project", p);
    await phone.engine.sync();
    await laptop.engine.sync();

    await saveRow(laptop.db, "project", { ...p, name: "Laptop", updatedAt: 2 });
    await laptop.engine.sync();
    // The phone edits the row between its push and its pull.
    server.onPull = () =>
      saveRow(phone.db, "project", { ...p, name: "Phone", updatedAt: 3 });
    await phone.engine.sync();
    expect((await phone.db.rows("project").get(p.id))?.name).toBe("Phone");
    expect(await phone.db.outbox.count()).toBe(1);

    await phone.engine.sync();
    await laptop.engine.sync();
    expect((await phone.db.rows("project").get(p.id))?.name).toBe("Phone");
    expect((await laptop.db.rows("project").get(p.id))?.name).toBe("Phone");
  });

  it("runs overlapping syncs one after another", async () => {
    const server = fakeServer();
    const { db, engine } = device(server);
    await saveRow(db, "project", project("x"));
    await Promise.all([engine.sync(), engine.sync(), engine.sync()]);
    // One run (push + pull), then one rerun for the calls that overlapped it.
    expect(server.requests).toBe(3);
    expect(server.rows.size).toBe(1);
  });
});

describe("chipLabel", () => {
  it.each([
    ["idle", 0, "Synced"],
    ["syncing", 0, "Synced"],
    ["idle", 2, "2 pending"],
    ["offline", 0, "Offline"],
    ["offline", 1, "Offline · 1 pending"],
    ["signed-out", 1, "Sign in to sync · 1 pending"],
    ["error", 0, "Sync failed"],
  ] as const)("%s with %i pending is %s", (state, pending, label) => {
    expect(chipLabel(state, pending)).toBe(label);
  });
});
