import {
  ENTITY_NAMES,
  type EntityName,
  type EntityRow,
  type RejectedOp,
  type SyncOp,
} from "@workout-app/shared";
import Dexie, { type Table } from "dexie";

/** A queued op, oldest first by `seq`. `rowId` finds the pending ops for a row. */
export type OutboxEntry = SyncOp & {
  seq?: number;
  rowId: string;
  queuedAt: number;
};

/** An op the server refused, keyed by `opId`. Kept so "export unsynced data" includes it. */
export type RejectedEntry = RejectedOp & { opId: string };

type Meta = { key: "cursor"; value: number };

export type LocalDb = Dexie & {
  outbox: Table<OutboxEntry, number>;
  rejected: Table<RejectedEntry, string>;
  meta: Table<Meta, string>;
  rows<E extends EntityName>(entity: E): Table<EntityRow<E>, string>;
};

/** The device's copy of every synced table, plus the outbox (SPEC §3.1). */
export function openLocalDb(name = "workout-app"): LocalDb {
  const db = new Dexie(name) as LocalDb;
  const entityStores = (names: readonly EntityName[]) =>
    Object.fromEntries(names.map((n) => [n, "id, serverSeq"]));
  // Version 2 adds `checklist` and `session_log.checked` (#121).
  db.version(2)
    .stores({
      ...entityStores(ENTITY_NAMES.filter((n) => n !== "fitness_state")),
      outbox: "++seq, &opId, [entity+rowId]",
      rejected: "opId",
      meta: "key",
    })
    .upgrade((tx) =>
      tx
        .table<{ checked?: string[] }>("session_log")
        .toCollection()
        .modify((log) => {
          log.checked ??= [];
        }),
    );
  // Version 3 adds `fitness_state` (#144).
  db.version(3).stores(entityStores(ENTITY_NAMES));
  db.rows = <E extends EntityName>(entity: E) =>
    db.table<EntityRow<E>, string>(entity);
  return db;
}
