import { useSyncExternalStore } from "react";
import { pendingCount, syncEngine } from "./sync";
import { chipLabel } from "./sync/engine";
import { useLiveQuery } from "./use-live-query";

/** Sync status (SPEC §3.2). Tapping it syncs now. */
export function SyncChip() {
  const state = useSyncExternalStore(syncEngine.subscribe, syncEngine.getState);
  const pending = useLiveQuery(pendingCount, 0);
  return (
    <button
      type="button"
      className="min-h-tap rounded-full bg-surface px-4 text-sm text-fg-muted active:bg-surface-raised"
      data-testid="sync-chip"
      title="Sync now"
      onClick={() => void syncEngine.sync()}
    >
      {chipLabel(state, pending)}
    </button>
  );
}
