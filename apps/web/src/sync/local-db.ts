import {
  ENTITY_NAMES,
  type EntityName,
  type EntityRow,
  type SyncOp,
} from "@workout-app/shared";
import Dexie, { type Table } from "dexie";

/** A queued op, oldest first by `seq`. `rowId` finds the pending ops for a row. */
export type OutboxEntry = SyncOp & {
  seq?: number;
  rowId: string;
  queuedAt: number;
};

/** An op the server refused. Kept so its data isn't lost (#30 exports it). */
export type RejectedOp = {
  opId: string;
  op: SyncOp;
  error: string;
  rejectedAt: number;
};

type Meta = { key: "cursor"; value: number };

export type LocalDb = Dexie & {
  outbox: Table<OutboxEntry, number>;
  rejected: Table<RejectedOp, string>;
  meta: Table<Meta, string>;
  rows<E extends EntityName>(entity: E): Table<EntityRow<E>, string>;
};

/** The device's copy of every synced table, plus the outbox (SPEC §3.1). */
export function openLocalDb(name = "workout-app"): LocalDb {
  const db = new Dexie(name) as LocalDb;
  db.version(1).stores({
    ...Object.fromEntries(ENTITY_NAMES.map((n) => [n, "id, serverSeq"])),
    outbox: "++seq, &opId, [entity+rowId]",
    rejected: "opId",
    meta: "key",
  });
  db.rows = <E extends EntityName>(entity: E) =>
    db.table<EntityRow<E>, string>(entity);
  return db;
}
