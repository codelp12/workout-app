import "fake-indexeddb/auto";
import {
  newId,
  type EntityName,
  type EntityRow,
  type PullResponse,
  type PushResult,
  type SyncOp,
  type UpsertData,
} from "@workout-app/shared";
import { describe, expect, it } from "vitest";
import { chipLabel, SyncEngine } from "./engine";
import { openLocalDb } from "./local-db";
import { deleteRow, saveRow } from "./writes";

type Change = { entity: EntityName; row: EntityRow<EntityName> };

/** Mimics /api/sync: op receipts, a global serverSeq and paged pulls (page size 2). */
function fakeServer() {
  const receipts = new Set<string>();
  const rows = new Map<string, Change>();
  let seq = 0;
  const server = {
    mode: "up" as "up" | "down" | "401" | "lose-response",
    requests: 0,
    rows,
    onPull: undefined as (() => Promise<void>) | undefined,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      server.requests++;
      await Promise.resolve();
      if (server.mode === "down") throw new TypeError("Failed to fetch");
      if (server.mode === "401") return new Response("{}", { status: 401 });
      const url = new URL(input as string, "http://test");
      if (url.pathname === "/api/sync/push") {
        const { ops } = JSON.parse(init?.body as string) as { ops: SyncOp[] };
        const results = ops.map((op): PushResult => {
          if (receipts.has(op.opId))
            return { opId: op.opId, status: "duplicate" };
          if ("name" in op.data && op.data.name === "bad") {
            return { opId: op.opId, status: "rejected", error: "bad name" };
          }
          receipts.add(op.opId);
          seq++;
          const existing = rows.get(op.data.id);
          const row =
            op.action === "upsert"
              ? { ...op.data, userId: 1, serverSeq: seq }
              : {
                  ...existing!.row,
                  deletedAt: op.data.deletedAt,
                  updatedAt: op.data.deletedAt,
                  serverSeq: seq,
                };
          rows.set(op.data.id, { entity: op.entity, row });
          return { opId: op.opId, status: "applied", serverSeq: seq };
        });
        if (server.mode === "lose-response") throw new TypeError("Dropped");
        return Response.json({ results, cursor: seq });
      }
      const onPull = server.onPull;
      server.onPull = undefined;
      await onPull?.();
      const since = Number(url.searchParams.get("since"));
      const newer = [...rows.values()]
        .filter((c) => c.row.serverSeq > since)
        .sort((a, b) => a.row.serverSeq - b.row.serverSeq);
      const changes = newer.slice(0, 2);
      const body: PullResponse = {
        changes: changes as PullResponse["changes"],
        cursor: changes.at(-1)?.row.serverSeq ?? since,
        hasMore: newer.length > 2,
      };
      return Response.json(body);
    },
  };
  return server;
}

function device(server: ReturnType<typeof fakeServer>) {
  const db = openLocalDb(`test-${newId()}`);
  return { db, engine: new SyncEngine(db, server.fetch) };
}

function project(name: string, now = 1000): UpsertData<"project"> {
  return {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    name,
    grade: "V4",
    status: "active",
    sentAt: null,
    notes: null,
  };
}

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
