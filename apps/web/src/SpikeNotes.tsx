import { liveQuery } from "dexie";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { addNote, pushOutbox, spikeDb, type SpikeNote } from "./spike-db";

type ServerNote = Pick<SpikeNote, "id" | "body" | "createdAt">;

function useLocalNotes() {
  const [notes, setNotes] = useState<SpikeNote[]>([]);
  useEffect(() => {
    const sub = liveQuery(() =>
      spikeDb.notes.orderBy("createdAt").reverse().toArray(),
    ).subscribe({ next: setNotes, error: console.error });
    return () => sub.unsubscribe();
  }, []);
  return notes;
}

// Throwaway offline-write spike (#21).
export function SpikeNotes() {
  const local = useLocalNotes();
  const [server, setServer] = useState<ServerNote[] | null>(null);
  const [draft, setDraft] = useState("");

  const refreshServer = useCallback(async () => {
    try {
      const res = await fetch("/api/spike");
      if (res.ok) setServer((await res.json()) as ServerNote[]);
    } catch {
      // Offline: keep showing the last list.
    }
  }, []);

  const sync = useCallback(async () => {
    await pushOutbox();
    await refreshServer();
  }, [refreshServer]);

  useEffect(() => {
    // sync() only sets state after awaiting the network, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void sync();
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    const onOnline = () => void sync();
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sync]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    await addNote(body);
    void sync();
  }

  const pending = local.filter((n) => !n.synced).length;

  return (
    <section aria-labelledby="spike-heading">
      <h2 id="spike-heading">Offline spike</h2>
      <form onSubmit={(e) => void onSubmit(e)}>
        <label>
          Note{" "}
          <input value={draft} onChange={(e) => setDraft(e.target.value)} />
        </label>{" "}
        <button type="submit">Save</button>{" "}
        <button type="button" onClick={() => void sync()}>
          Sync now
        </button>
      </form>
      <p data-testid="pending">{pending} pending</p>

      <h3>On this device</h3>
      <ul data-testid="local-notes">
        {local.map((n) => (
          <li key={n.id}>
            {n.body}
            {n.synced ? "" : " (pending)"}
          </li>
        ))}
      </ul>

      <h3>On the server</h3>
      {server === null ? (
        <p>Not loaded (offline?)</p>
      ) : (
        <ul data-testid="server-notes">
          {server.map((n) => (
            <li key={n.id}>{n.body}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
