import { desc } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "./db.js";
import { spikeNotes } from "./schema.js";

const pushBody = z.object({
  opId: z.uuid(),
  id: z.uuid(),
  body: z.string().trim().min(1).max(2000),
  createdAt: z.number().int().nonnegative(),
});

// Throwaway offline-write spike (#21): replaced by /api/sync in Epic B.
export function spikeRoutes(db: Db) {
  const routes = new Hono();

  routes.post("/", async (c) => {
    const parsed = pushBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid note" }, 400);
    const result = db
      .insert(spikeNotes)
      .values({ ...parsed.data, receivedAt: Date.now() })
      .onConflictDoNothing()
      .run();
    return c.json({ ok: true, duplicate: result.changes === 0 });
  });

  routes.get("/", (c) =>
    c.json(
      db
        .select({
          id: spikeNotes.id,
          body: spikeNotes.body,
          createdAt: spikeNotes.createdAt,
        })
        .from(spikeNotes)
        .orderBy(desc(spikeNotes.createdAt))
        .all(),
    ),
  );

  return routes;
}
