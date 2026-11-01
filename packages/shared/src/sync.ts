// Wire format for /api/sync (SPEC §3.2).
import { z } from "zod";
import {
  ENTITY_NAMES,
  entitySchemas,
  type EntityName,
  type EntityRow,
} from "./entities.js";

export const MAX_PUSH_OPS = 500;
export const DEFAULT_PULL_LIMIT = 500;
export const MAX_PULL_LIMIT = 1000;

export const SYNC_ACTIONS = ["upsert", "delete"] as const;
export type SyncAction = (typeof SYNC_ACTIONS)[number];

/** An upsert sends the whole row; the server fills in `userId` and `serverSeq`. */
export type UpsertData<E extends EntityName> = Omit<
  EntityRow<E>,
  "userId" | "serverSeq"
>;

export const upsertDataSchemas = Object.fromEntries(
  ENTITY_NAMES.map((name) => [
    name,
    (entitySchemas[name] as z.ZodObject).omit({
      userId: true,
      serverSeq: true,
    }),
  ]),
) as unknown as { [E in EntityName]: z.ZodType<UpsertData<E>> };

/** A delete sets the row's tombstone. */
export const deleteDataSchema = z.object({
  id: z.uuid(),
  deletedAt: z.int().nonnegative(),
});
export type DeleteData = z.infer<typeof deleteDataSchema>;

/** The op envelope. `data` is checked against the entity's schema separately. */
export const syncOpSchema = z.object({
  opId: z.uuid(),
  entity: z.enum(ENTITY_NAMES as [EntityName, ...EntityName[]]),
  action: z.enum(SYNC_ACTIONS),
  data: z.unknown(),
});

export type SyncOp = {
  [E in EntityName]: { opId: string; entity: E } & (
    | { action: "upsert"; data: UpsertData<E> }
    | { action: "delete"; data: DeleteData }
  );
}[EntityName];

export type PushRequest = { ops: SyncOp[] };

/**
 * - `applied`: written, or a delete of a row the server never had (`serverSeq` null).
 * - `duplicate`: this `opId` was already applied, so nothing changed.
 * - `rejected`: invalid; nothing was written. Resending it unchanged won't help.
 */
export type PushResult =
  | { opId: string; status: "applied"; serverSeq: number | null }
  | { opId: string; status: "duplicate" }
  | { opId: string; status: "rejected"; error: string };

export type PushResponse = {
  results: PushResult[];
  /**
   * The server's latest `serverSeq`. Don't jump your pull cursor to it, since
   * that would skip other clients' writes; pull from your own cursor until
   * you reach it.
   */
  cursor: number;
};

export type SyncChange = {
  [E in EntityName]: { entity: E; row: EntityRow<E> };
}[EntityName];

/** Rows (tombstones included) with `serverSeq` > `since`, oldest first. */
export type PullResponse = {
  changes: SyncChange[];
  /** Pass as `since` next time. */
  cursor: number;
  /** More rows are waiting: pull again with the new cursor. */
  hasMore: boolean;
};

export const UNSYNCED_EXPORT_FORMAT = "workout-app/unsynced";

/** An op the server refused, kept so its data isn't lost. */
export type RejectedOp = { op: SyncOp; error: string; rejectedAt: number };

/**
 * The "export unsynced data" file (SPEC §3.4). `ops` are the queued writes,
 * oldest first, exactly as `/api/sync/push` takes them, so importing replays
 * them and the server's `opId` dedupe makes a second import harmless.
 * `rejected` ops are kept for reference; sending them again won't succeed.
 */
export type UnsyncedExport = {
  format: typeof UNSYNCED_EXPORT_FORMAT;
  version: 1;
  exportedAt: number;
  ops: SyncOp[];
  rejected: RejectedOp[];
};

/** Checks the envelope; each op's `data` is checked when it's pushed. */
export const unsyncedExportSchema = z.object({
  format: z.literal(UNSYNCED_EXPORT_FORMAT),
  version: z.literal(1),
  exportedAt: z.int().nonnegative(),
  ops: z.array(syncOpSchema.extend({ data: z.looseObject({ id: z.uuid() }) })),
  rejected: z.array(
    z.object({
      op: syncOpSchema,
      error: z.string(),
      rejectedAt: z.int().nonnegative(),
    }),
  ),
});
