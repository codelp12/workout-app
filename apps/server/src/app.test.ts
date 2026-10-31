import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { openDb, runMigrations } from "./db.js";

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  const db = openDb(":memory:");
  runMigrations(db);
  app = createApp(db);
});

describe("server", () => {
  it("reports healthy on /healthz", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("says hello on /api/hello", async () => {
    const res = await app.request("/api/hello");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Hello, world" });
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});

describe("/api/spike", () => {
  const note = {
    opId: "0199f0a0-0000-7000-8000-000000000001",
    id: "0199f0a0-0000-7000-8000-0000000000aa",
    body: "Written offline",
    createdAt: 1_793_450_000_000,
  };
  const push = (body: unknown) =>
    app.request("/api/spike", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("stores a pushed note and lists it", async () => {
    expect(await (await push(note)).json()).toEqual({
      ok: true,
      duplicate: false,
    });
    const list = await (await app.request("/api/spike")).json();
    expect(list).toEqual([
      { id: note.id, body: note.body, createdAt: note.createdAt },
    ]);
  });

  it("ignores a retried push with the same op id", async () => {
    await push(note);
    const retry = await push(note);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true, duplicate: true });
    const list = (await (await app.request("/api/spike")).json()) as unknown[];
    expect(list).toHaveLength(1);
  });

  it("rejects invalid notes", async () => {
    expect((await push({ ...note, body: "  " })).status).toBe(400);
    expect((await push({ ...note, opId: "nope" })).status).toBe(400);
    expect(
      (await app.request("/api/spike", { method: "POST", body: "{" })).status,
    ).toBe(400);
  });
});
