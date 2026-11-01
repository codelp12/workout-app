import {
  UNSYNCED_EXPORT_FORMAT,
  unsyncedExportSchema,
  type EntityName,
  type SyncOp,
  type UnsyncedExport,
} from "@workout-app/shared";
import type { LocalDb, OutboxEntry } from "./local-db";
import { OWNER_USER_ID } from "./writes";

export type UnsyncedSummary = {
  /** Distinct training sessions with a queued or rejected write. */
  sessions: number;
  /** Queued ops. */
  pending: number;
  rejected: number;
};

/** Entities that belong to a `session_log` through `sessionLogId`. */
const SESSION_CHILDREN = new Set<EntityName>(["set_log", "run_log", "ascent"]);

async function sessionIdOf(db: LocalDb, op: SyncOp): Promise<string | null> {
  if (op.entity === "session_log") return op.data.id;
  if (!SESSION_CHILDREN.has(op.entity)) return null;
  if ("sessionLogId" in op.data) return op.data.sessionLogId;
  const row = (await db.rows(op.entity).get(op.data.id)) as
    { sessionLogId: string } | undefined;
  return row?.sessionLogId ?? null;
}

/** What hasn't reached the server, for the "N unsynced sessions" warning (SPEC §3.4). */
export async function unsyncedSummary(db: LocalDb): Promise<UnsyncedSummary> {
  const queued = await db.outbox.toArray();
  const rejected = await db.rejected.toArray();
  const sessions = new Set<string>();
  for (const op of [...queued, ...rejected.map((r) => r.op)]) {
    const id = await sessionIdOf(db, op);
    if (id) sessions.add(id);
  }
  return {
    sessions: sessions.size,
    pending: queued.length,
    rejected: rejected.length,
  };
}

const toOp = ({ opId, entity, action, data }: OutboxEntry) =>
  ({ opId, entity, action, data }) as SyncOp;

/** Everything not yet on the server, as an "export unsynced data" file (SPEC §3.4). */
export async function exportUnsynced(
  db: LocalDb,
  now = Date.now(),
): Promise<UnsyncedExport> {
  const queued = await db.outbox.orderBy("seq").toArray();
  const rejected = (await db.rejected.toArray()).sort(
    (a, b) => a.rejectedAt - b.rejectedAt,
  );
  return {
    format: UNSYNCED_EXPORT_FORMAT,
    version: 1,
    exportedAt: now,
    ops: queued.map(toOp),
    rejected: rejected.map(({ op, error, rejectedAt }) => ({
      op,
      error,
      rejectedAt,
    })),
  };
}

export const exportFileName = (now = Date.now()) =>
  `workout-app-unsynced-${new Date(now).toISOString().replace(/[:.]/g, "-")}.json`;

export class ImportError extends Error {}

/**
 * Queues an export file's ops for the next sync, keeping their `opId`s so the
 * server skips any it already has. A row this device doesn't have is written
 * locally too; an existing row is left alone, since it may be newer than the
 * file. Rejected ops aren't queued: sending them again would fail the same way.
 */
export async function importUnsynced(
  db: LocalDb,
  file: unknown,
  now = Date.now(),
): Promise<{ queued: number; skipped: number }> {
  const parsed = unsyncedExportSchema.safeParse(file);
  if (!parsed.success) {
    throw new ImportError("This isn't a workout-app unsynced-data file.");
  }
  const ops = parsed.data.ops as SyncOp[];
  let queued = 0;
  await db.transaction("rw", db.tables, async () => {
    for (const op of ops) {
      if (await db.outbox.where("opId").equals(op.opId).count()) continue;
      const table = db.rows(op.entity);
      const existing = await table.get(op.data.id);
      if (op.action === "upsert" && !existing) {
        await table.put({
          ...op.data,
          userId: OWNER_USER_ID,
          serverSeq: 0,
        });
      }
      if (op.action === "delete" && existing && existing.deletedAt === null) {
        const { deletedAt } = op.data;
        await table.put({ ...existing, deletedAt, updatedAt: deletedAt });
      }
      await db.outbox.add({
        ...op,
        rowId: op.data.id,
        queuedAt: now,
      });
      queued++;
    }
  });
  return { queued, skipped: ops.length - queued };
}
