import { exerciseSchema, libraryExerciseId } from "@workout-app/shared";
import type { PullResponse } from "@workout-app/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { setPassword } from "./auth.js";
import { openDb, runMigrations, type Db } from "./db.js";
import { exercise } from "./schema.js";
import { LIBRARY_DATASET, seedExercises } from "./seed.js";

const T0 = Date.UTC(2026, 10, 1);
let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
  runMigrations(db);
});

const pushupsId = libraryExerciseId(LIBRARY_DATASET, "Pushups");

describe("seedExercises", () => {
  it("adds the whole library with stable ids and fresh server seqs", () => {
    const added = seedExercises(db, T0);
    expect(added).toBeGreaterThan(800);
    const rows = db.select().from(exercise).all();
    expect(rows).toHaveLength(added);
    for (const row of rows) exerciseSchema.parse(row);
    expect(new Set(rows.map((r) => r.serverSeq)).size).toBe(added);

    const pushups = rows.find((r) => r.id === pushupsId);
    expect(pushups).toMatchObject({
      name: "Pushups",
      sourceId: "Pushups",
      license: "Unlicense",
      createdAt: T0,
      deletedAt: null,
    });
    expect(pushups?.source).toMatch(/^free-exercise-db@[0-9a-f]{40}$/);
  });

  it("is a no-op on later runs and never overwrites existing rows", () => {
    seedExercises(db, T0);
    db.update(exercise)
      .set({ cues: ["Elbows at 45°"], deletedAt: null })
      .where(eq(exercise.id, pushupsId))
      .run();
    const deleted = libraryExerciseId(LIBRARY_DATASET, "Plank");
    db.update(exercise)
      .set({ deletedAt: T0 })
      .where(eq(exercise.id, deleted))
      .run();

    expect(seedExercises(db, T0 + 1)).toBe(0);
    const row = (id: string) =>
      db.select().from(exercise).where(eq(exercise.id, id)).get();
    expect(row(pushupsId)?.cues).toEqual(["Elbows at 45°"]);
    expect(row(deleted)?.deletedAt).toBe(T0);
  });

  it("adds only what's missing", () => {
    const total = seedExercises(db, T0);
    db.delete(exercise).where(eq(exercise.id, pushupsId)).run();
    expect(seedExercises(db, T0)).toBe(1);
    expect(db.select().from(exercise).all()).toHaveLength(total);
  });

  it("reaches a fresh device on its first pull", async () => {
    const total = seedExercises(db, T0);
    const app = createApp(db, { now: () => T0 });
    await setPassword(db, "correct horse battery");
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "correct horse battery" }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;

    const ids = new Set<string>();
    for (let since = 0, more = true; more;) {
      const res = await app.request(`/api/sync/pull?since=${since}`, {
        headers: { cookie },
      });
      const page = (await res.json()) as PullResponse;
      for (const c of page.changes)
        if (c.entity === "exercise") ids.add(c.row.id);
      since = page.cursor;
      more = page.hasMore;
    }
    expect(ids.size).toBe(total);
    expect(ids.has(pushupsId)).toBe(true);
  });
});
