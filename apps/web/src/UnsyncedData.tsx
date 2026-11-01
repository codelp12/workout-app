import { useState, useSyncExternalStore, type ChangeEvent } from "react";
import { localDb, syncEngine, syncSoon } from "./sync";
import {
  exportFileName,
  exportUnsynced,
  ImportError,
  importUnsynced,
  unsyncedSummary,
  type UnsyncedSummary,
} from "./sync/unsynced";
import { useLiveQuery } from "./use-live-query";
import { button, card } from "./ui";

const summaryQuery = () => unsyncedSummary(localDb);
const none: UnsyncedSummary = { sessions: 0, pending: 0, rejected: 0 };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function download(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // Safari may still be reading the blob when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function exportToFile() {
  const now = Date.now();
  download(exportFileName(now), await exportUnsynced(localDb, now));
}

/**
 * "N unsynced sessions" plus an export button, the last resort against iOS
 * evicting the app's storage before it syncs (SPEC §3.4). Hidden while a sync
 * is running, so a normal online write doesn't flash it.
 */
export function UnsyncedWarning() {
  const state = useSyncExternalStore(syncEngine.subscribe, syncEngine.getState);
  const { sessions, pending, rejected } = useLiveQuery(summaryQuery, none);
  if (state === "syncing" || pending + rejected === 0) return null;
  const parts = [
    sessions > 0
      ? plural(sessions, "unsynced session")
      : pending > 0 && plural(pending, "unsynced change"),
    rejected > 0 && `${plural(rejected, "change")} the server couldn't accept`,
  ].filter(Boolean);
  return (
    <section
      role="status"
      aria-label="Unsynced data"
      className={`${card} border border-warning`}
    >
      <p>
        <strong className="text-warning">{parts.join(" · ")}</strong>
      </p>
      <p className="mt-1 text-sm text-fg-muted">
        This is only on this device until it syncs. If sync keeps failing,
        export it to a file so it isn't lost.
      </p>
      <button
        type="button"
        className={`${button} mt-3`}
        onClick={() => void exportToFile()}
      >
        Export unsynced data
      </button>
    </section>
  );
}

/** Restores an "export unsynced data" file: its ops are queued and synced. */
export function ImportUnsynced() {
  const [message, setMessage] = useState("");

  async function onChange(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const { queued, skipped } = await importUnsynced(
        localDb,
        JSON.parse(await file.text()),
      );
      setMessage(
        `Imported ${plural(queued, "change")}` +
          (skipped > 0 ? ` (${skipped} already queued)` : "") +
          ".",
      );
      syncSoon();
    } catch (error) {
      const badFile =
        error instanceof ImportError || error instanceof SyntaxError;
      if (!badFile) console.error("Import failed", error);
      setMessage(
        badFile
          ? "This isn't a workout-app unsynced-data file."
          : "Import failed.",
      );
    } finally {
      input.value = "";
    }
  }

  return (
    <section className={card}>
      <label className="flex flex-col gap-2 text-sm">
        Import unsynced data{" "}
        <input
          type="file"
          className="text-fg-muted file:mr-3 file:min-h-tap file:rounded-lg file:border-0 file:bg-surface-raised file:px-4 file:font-medium file:text-fg"
          accept="application/json,.json"
          onChange={(e) => void onChange(e)}
        />
      </label>
      {message && (
        <p role="status" className="mt-2 text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
