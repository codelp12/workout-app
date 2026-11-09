import {
  DEFAULT_PULL_LIMIT,
  ENTITY_NAMES,
  MAX_PULL_LIMIT,
  MAX_PUSH_OPS,
  deleteDataSchema,
  syncOpSchema,
  upsertDataSchemas,
  type PullResponse,
  type PushResponse,
  type PushResult,
  type SyncChange,
} from "@workout-app/shared";
import { asc, eq, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "./db.js";
import { entityTables } from "./entity-tables.js";
import { planCurrentWeek } from "./plan.js";
import { opReceipt, syncCounter } from "./schema.js";

/** Single-user app (SPEC §1): every row belongs to the one account. */
export const OWNER_USER_ID = 1;

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
// One table type stands in for all of them: every op touches only the shared sync columns or a row its schema has validated.
type EntityTable = typeof entityTables.exercise;

// Ops are validated one at a time, so one bad op is rejected alone instead of failing the batch and blocking the outbox behind it.
const pushBody = z.object({
  ops: z
    .array(z.looseObject({ opId: z.uuid() }))
    .min(1)
    .max(MAX_PUSH_OPS),
});

const pullQuery = z.object({
  since: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PULL_LIMIT)
    .default(DEFAULT_PULL_LIMIT),
});

/** Claims the next global `serverSeq`. */
export function nextSeq(tx: Tx): number {
  return tx
    .insert(syncCounter)
    .values({ id: 1, lastSeq: 1 })
    .onConflictDoUpdate({
      target: syncCounter.id,
      set: { lastSeq: sql`${syncCounter.lastSeq} + 1` },
    })
    .returning({ seq: syncCounter.lastSeq })
    .get().seq;
}

function currentSeq(tx: Tx): number {
  return (
    tx
      .select({ seq: syncCounter.lastSeq })
      .from(syncCounter)
      .where(eq(syncCounter.id, 1))
      .get()?.seq ?? 0
  );
}

const rejected = (opId: string, error: z.ZodError): PushResult => ({
  opId,
  status: "rejected",
  error: z.prettifyError(error),
});

/** Applies one op. Last write wins: the later op by server receipt overwrites the row. */
function applyOp(tx: Tx, raw: { opId: string }, now: number): PushResult {
  const { opId } = raw;
  const seen = tx
    .select({ opId: opReceipt.opId })
    .from(opReceipt)
    .where(eq(opReceipt.opId, opId))
    .get();
  if (seen) return { opId, status: "duplicate" };

  const op = syncOpSchema.safeParse(raw);
  if (!op.success) return rejected(opId, op.error);
  const table = entityTables[op.data.entity] as EntityTable;

  let serverSeq: number | null = null;
  if (op.data.action === "upsert") {
    const data = upsertDataSchemas[op.data.entity].safeParse(op.data.data);
    if (!data.success) return rejected(opId, data.error);
    serverSeq = nextSeq(tx);
    const row = { ...data.data, userId: OWNER_USER_ID, serverSeq };
    // Keep the first write's createdAt; overwrite everything else.
    const update = { ...row } as Partial<EntityTable["$inferInsert"]>;
    delete update.id;
    delete update.createdAt;
    tx.insert(table)
      .values(row as EntityTable["$inferInsert"])
      .onConflictDoUpdate({
        target: table.id,
        set: update,
      })
      .run();
  } else {
    const data = deleteDataSchema.safeParse(op.data.data);
    if (!data.success) return rejected(opId, data.error);
    const { id, deletedAt } = data.data;
    const exists = tx
      .select({ id: table.id })
      .from(table)
      .where(eq(table.id, id))
      .get();
    if (exists) {
      serverSeq = nextSeq(tx);
      tx.update(table)
        .set({ deletedAt, updatedAt: deletedAt, serverSeq })
        .where(eq(table.id, id))
        .run();
    }
  }

  tx.insert(opReceipt)
    .values({ opId, userId: OWNER_USER_ID, receivedAt: now })
    .run();
  return { opId, status: "applied", serverSeq };
}

/**
 * Sync v1 (SPEC §3.2): push ops, pull changed rows and tombstones by cursor.
 * With `planWeeks`, a pull first runs the weekly rollover.
 */
export function syncRoutes(
  db: Db,
  now: () => number = Date.now,
  planWeeks = true,
) {
  const routes = new Hono();

  routes.post("/push", async (c) => {
    const body = pushBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid push" }, 400);
    const receivedAt = now();
    const response = db.transaction((tx): PushResponse => ({
      results: body.data.ops.map((op) => applyOp(tx, op, receivedAt)),
      cursor: currentSeq(tx),
    }));
    return c.json(response);
  });

  routes.get("/pull", (c) => {
    const query = pullQuery.safeParse(c.req.query());
    if (!query.success) return c.json({ error: "Invalid cursor" }, 400);
    const { since, limit } = query.data;
    if (planWeeks) planCurrentWeek(db, now());
    // Take up to limit + 1 from each table: if the merged list is longer than limit, there's another page.
    const changes = ENTITY_NAMES.flatMap((entity) => {
      const table = entityTables[entity] as EntityTable;
      return db
        .select()
        .from(table)
        .where(gt(table.serverSeq, since))
        .orderBy(asc(table.serverSeq))
        .limit(limit + 1)
        .all()
        .map((row) => ({ entity, row }) as SyncChange);
    }).sort((a, b) => a.row.serverSeq - b.row.serverSeq);
    const page = changes.slice(0, limit);
    const response: PullResponse = {
      changes: page,
      cursor: page.at(-1)?.row.serverSeq ?? since,
      hasMore: changes.length > limit,
    };
    return c.json(response);
  });

  return routes;
}
