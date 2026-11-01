import type { EntityName, UpsertData } from "@workout-app/shared";
import { SyncEngine } from "./engine";
import { openLocalDb } from "./local-db";
import { deleteRow, saveRow } from "./writes";

export const localDb = openLocalDb();
export const syncEngine = new SyncEngine(localDb);

/** Starts a sync in the background. Call after finishing a workout (SPEC §3.2). */
export function syncSoon(): void {
  void syncEngine.sync();
}

/** Saves locally, then syncs in the background. Resolves before any network call. */
export async function save<E extends EntityName>(
  entity: E,
  data: UpsertData<E>,
): Promise<void> {
  await saveRow(localDb, entity, data);
  syncSoon();
}

export async function remove(entity: EntityName, id: string): Promise<void> {
  await deleteRow(localDb, entity, id);
  syncSoon();
}

export const pendingCount = () => localDb.outbox.count();
export const pendingRowIds = async () =>
  new Set((await localDb.outbox.toArray()).map((op) => op.rowId));
