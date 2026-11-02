import {
  MAX_PUSH_OPS,
  newId,
  type EntityName,
  type PullResponse,
  type PushResponse,
  type SyncChange,
  type SyncOp,
  type UpsertData,
} from "@workout-app/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { setPassword } from "./auth.js";
import { openDb, runMigrations } from "./db.js";

const PASSWORD = "correct horse battery";
const T0 = Date.UTC(2026, 9, 31, 14);
const json = { "content-type": "application/json" };

let app: ReturnType<typeof createApp>;
let cookie: string;

beforeEach(async () => {
  const db = openDb(":memory:");
  runMigrations(db);
  app = createApp(db, { now: () => T0, planWeeks: false });
  await setPassword(db, PASSWORD);
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ password: PASSWORD }),
  });
  cookie = res.headers.get("set-cookie")!.split(";")[0]!;
});

const project = (
  fields: Partial<UpsertData<"project">> = {},
): UpsertData<"project"> => ({
  id: newId(),
  createdAt: T0,
  updatedAt: T0,
  deletedAt: null,
  name: "Blue overhang",
  grade: "V5",
  status: "active",
  sentAt: null,
  notes: null,
  ...fields,
});

const ascent = (
  fields: Partial<UpsertData<"ascent">> = {},
): UpsertData<"ascent"> => ({
  id: newId(),
  createdAt: T0,
  updatedAt: T0,
  deletedAt: null,
  sessionLogId: newId(),
  projectId: null,
  grade: "V4",
  style: "flash",
  attempts: 1,
  tags: [],
  ...fields,
});

const upsert = <E extends EntityName>(
  entity: E,
  data: UpsertData<E>,
  opId = newId(),
) => ({ opId, entity, action: "upsert", data }) as SyncOp;

const del = (entity: EntityName, id: string, deletedAt: number) =>
  ({
    opId: newId(),
    entity,
    action: "delete",
    data: { id, deletedAt },
  }) as SyncOp;

const pushRaw = (body: unknown, auth = cookie) =>
  app.request("/api/sync/push", {
    method: "POST",
    headers: { ...json, cookie: auth },
    body: JSON.stringify(body),
  });

async function push(ops: unknown[]): Promise<PushResponse> {
  const res = await pushRaw({ ops });
  expect(res.status).toBe(200);
  return (await res.json()) as PushResponse;
}

async function pull(since: number, limit?: number): Promise<PullResponse> {
  const query = limit === undefined ? "" : `&limit=${limit}`;
  const res = await app.request(`/api/sync/pull?since=${since}${query}`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as PullResponse;
}

/** A device with an outbox, a pull cursor and a local copy of every row. */
class Client {
  outbox: SyncOp[] = [];
  cursor = 0;
  rows = new Map<string, SyncChange["row"]>();

  queue(...ops: SyncOp[]) {
    this.outbox.push(...ops);
  }

  /** `dropResponse` simulates the connection dying after the server applied the batch. */
  async push({ dropResponse = false } = {}) {
    const response = await push(this.outbox);
    if (dropResponse) return response;
    const acked = new Set(response.results.map((r) => r.opId));
    this.outbox = this.outbox.filter((op) => !acked.has(op.opId));
    return response;
  }

  async pull(limit?: number) {
    let page: PullResponse;
    do {
      page = await pull(this.cursor, limit);
      for (const { row } of page.changes) this.rows.set(row.id, row);
      this.cursor = page.cursor;
    } while (page.hasMore);
  }
}

describe("POST /api/sync/push", () => {
  it("applies upserts and stamps them with the owner and a server seq", async () => {
    const row = project();
    const op = upsert("project", {
      ...row,
      userId: 99,
      serverSeq: 999,
    } as never);
    const { results, cursor } = await push([op]);
    expect(results).toEqual([
      { opId: op.opId, status: "applied", serverSeq: 1 },
    ]);
    expect(cursor).toBe(1);
    const { changes } = await pull(0);
    expect(changes).toEqual([
      { entity: "project", row: { ...row, userId: 1, serverSeq: 1 } },
    ]);
  });

  it("skips duplicate ops in a batch and replayed ops in later batches", async () => {
    const op = upsert("project", project());
    const first = await push([op, op]);
    expect(first.results.map((r) => r.status)).toEqual([
      "applied",
      "duplicate",
    ]);
    const replay = await push([op]);
    expect(replay.results).toEqual([{ opId: op.opId, status: "duplicate" }]);
    expect(replay.cursor).toBe(1);
    expect((await pull(0)).changes).toHaveLength(1);
  });

  it("doesn't re-apply a replayed op over a newer write", async () => {
    const row = project();
    const create = upsert("project", row);
    await push([create, upsert("project", { ...row, grade: "V6" })]);
    await push([create]);
    expect((await pull(0)).changes[0]!.row).toMatchObject({ grade: "V6" });
  });

  it("rejects invalid ops one by one and applies the rest", async () => {
    const good = upsert("project", project());
    const badData = upsert("project", {
      ...project(),
      status: "nope",
    } as never);
    const badEntity = { ...good, opId: newId(), entity: "nope" };
    const { results } = await push([badData, good, badEntity]);
    expect(results.map((r) => r.status)).toEqual([
      "rejected",
      "applied",
      "rejected",
    ]);
    const [first] = results;
    expect(first?.status === "rejected" && first.error).toContain("status");
    expect((await pull(0)).changes).toHaveLength(1);

    // A rejected op leaves no receipt, so a fixed op with the same id applies.
    const fixed = upsert("project", project(), badData.opId);
    expect((await push([fixed])).results[0]!.status).toBe("applied");
  });

  it("keeps the first write's createdAt", async () => {
    const row = project();
    await push([upsert("project", row)]);
    await push([upsert("project", { ...row, createdAt: T0 + 5, notes: "x" })]);
    expect((await pull(0)).changes[0]!.row).toMatchObject({
      createdAt: T0,
      notes: "x",
      serverSeq: 2,
    });
  });

  it("rejects malformed batches", async () => {
    const op = upsert("project", project());
    expect((await pushRaw({ ops: [] })).status).toBe(400);
    expect((await pushRaw({ ops: [{ ...op, opId: "x" }] })).status).toBe(400);
    expect(
      (await pushRaw({ ops: Array(MAX_PUSH_OPS + 1).fill(op) })).status,
    ).toBe(400);
    expect((await pushRaw("nope")).status).toBe(400);
  });

  it("needs a session", async () => {
    expect((await pushRaw({ ops: [] }, "")).status).toBe(401);
    expect((await app.request("/api/sync/pull")).status).toBe(401);
  });
});

describe("two clients", () => {
  it("converge, with the later push winning regardless of client clocks", async () => {
    const phone = new Client();
    const laptop = new Client();
    const row = project();
    phone.queue(upsert("project", row));
    await phone.push();
    await laptop.pull();
    expect(laptop.rows.get(row.id)).toMatchObject({ grade: "V5" });

    // The phone's clock is ahead, but the laptop's edit reaches the server last.
    phone.queue(
      upsert("project", { ...row, grade: "V6", updatedAt: T0 + 60_000 }),
    );
    laptop.queue(upsert("project", { ...row, grade: "V7", updatedAt: T0 + 1 }));
    await phone.push();
    await laptop.push();
    await phone.pull();
    await laptop.pull();
    expect(phone.rows.get(row.id)).toMatchObject({ grade: "V7" });
    expect(laptop.rows.get(row.id)).toEqual(phone.rows.get(row.id));
  });

  it("propagate deletes as tombstones", async () => {
    const phone = new Client();
    const laptop = new Client();
    const row = project();
    laptop.queue(upsert("project", row));
    await laptop.push();
    await phone.pull();

    phone.queue(del("project", row.id, T0 + 10));
    const { results } = await phone.push();
    expect(results[0]).toMatchObject({ status: "applied", serverSeq: 2 });
    await laptop.pull();
    expect(laptop.rows.get(row.id)).toMatchObject({
      deletedAt: T0 + 10,
      updatedAt: T0 + 10,
      serverSeq: 2,
    });

    // Pulling from scratch still returns the tombstone, not nothing.
    const fresh = new Client();
    await fresh.pull();
    expect(fresh.rows.get(row.id)).toMatchObject({ deletedAt: T0 + 10 });
  });

  it("treat a delete of a row the server never had as a no-op", async () => {
    const op = del("project", newId(), T0);
    const { results, cursor } = await push([op]);
    expect(results).toEqual([
      { opId: op.opId, status: "applied", serverSeq: null },
    ]);
    expect(cursor).toBe(0);
    expect((await pull(0)).changes).toEqual([]);
  });
});

describe("flaky network", () => {
  it("loses nothing and duplicates nothing when push responses are lost", async () => {
    const phone = new Client();
    const rows = [project(), project(), project()];
    phone.queue(...rows.slice(0, 2).map((r) => upsert("project", r)));
    await phone.push({ dropResponse: true });
    expect(phone.outbox).toHaveLength(2);

    // Retry with more ops queued behind the ones the server already has.
    phone.queue(upsert("project", rows[2]!));
    const { results } = await phone.push();
    expect(results.map((r) => r.status)).toEqual([
      "duplicate",
      "duplicate",
      "applied",
    ]);
    expect(phone.outbox).toEqual([]);

    const laptop = new Client();
    await laptop.pull();
    expect([...laptop.rows.keys()].sort()).toEqual(
      rows.map((r) => r.id).sort(),
    );
  });

  it("resumes a pull from the last cursor after a lost page", async () => {
    await push([1, 2, 3].map(() => upsert("project", project())));
    const lost = await pull(0, 2);
    const retry = await pull(0, 2);
    expect(retry).toEqual(lost);
  });
});

describe("GET /api/sync/pull", () => {
  it("pages through every change across entities in seq order", async () => {
    const ops = Array.from({ length: 25 }, (_, i) =>
      i % 3 ? upsert("project", project()) : upsert("ascent", ascent()),
    );
    await push(ops);

    const pages: PullResponse[] = [];
    let cursor = 0;
    do {
      pages.push(await pull(cursor, 10));
      cursor = pages.at(-1)!.cursor;
    } while (pages.at(-1)!.hasMore);

    expect(pages.map((p) => p.changes.length)).toEqual([10, 10, 5]);
    expect(pages.map((p) => p.cursor)).toEqual([10, 20, 25]);
    const changes = pages.flatMap((p) => p.changes);
    expect(changes.map((c) => c.row.serverSeq)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
    expect(changes.map((c) => c.entity)).toEqual(ops.map((op) => op.entity));
    expect(await pull(25)).toEqual({ changes: [], cursor: 25, hasMore: false });
  });

  it("returns a row once, at its latest seq, after repeated edits", async () => {
    const row = project();
    await push([upsert("project", row), upsert("ascent", ascent())]);
    await push([upsert("project", { ...row, notes: "edited" })]);
    const { changes } = await pull(0);
    expect(changes.map((c) => [c.entity, c.row.serverSeq])).toEqual([
      ["ascent", 2],
      ["project", 3],
    ]);
    expect((await pull(2)).changes.map((c) => c.row.id)).toEqual([row.id]);
  });

  it("rejects a bad cursor or limit", async () => {
    for (const query of ["since=-1", "since=abc", "limit=0", "limit=5000"]) {
      const res = await app.request(`/api/sync/pull?${query}`, {
        headers: { cookie },
      });
      expect(res.status).toBe(400);
    }
  });
});
