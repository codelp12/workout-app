import {
  newId,
  type EntityName,
  type EntityRow,
  type UpsertData,
} from "@workout-app/shared";
import type { LocalDb, OutboxEntry } from "./local-db";

/** Single-user app: matches the server's owner id. */
const OWNER_USER_ID = 1;

/** Writes a row locally and queues it for the server in one transaction. Never touches the network. */
export async function saveRow<E extends EntityName>(
  db: LocalDb,
  entity: E,
  data: UpsertData<E>,
  now = Date.now(),
): Promise<void> {
  const table = db.rows(entity);
  await db.transaction("rw", table, db.outbox, async () => {
    const existing = await table.get(data.id);
    await table.put({
      ...data,
      userId: OWNER_USER_ID,
      serverSeq: existing?.serverSeq ?? 0,
    } as EntityRow<E>);
    await db.outbox.add({
      opId: newId(),
      entity,
      action: "upsert",
      data,
      rowId: data.id,
      queuedAt: now,
    } as OutboxEntry);
  });
}

/** Tombstones a row locally and queues the delete. A missing row is a no-op. */
export async function deleteRow(
  db: LocalDb,
  entity: EntityName,
  id: string,
  now = Date.now(),
): Promise<void> {
  const table = db.rows(entity);
  await db.transaction("rw", table, db.outbox, async () => {
    const row = await table.get(id);
    if (!row) return;
    await table.put({ ...row, deletedAt: now, updatedAt: now });
    await db.outbox.add({
      opId: newId(),
      entity,
      action: "delete",
      data: { id, deletedAt: now },
      rowId: id,
      queuedAt: now,
    });
  });
}
