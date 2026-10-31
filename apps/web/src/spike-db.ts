import Dexie, { type EntityTable } from "dexie";

// Throwaway offline-write spike (#21): replaced by the real local store and
// sync engine in Epic B (#28).

export type SpikeNote = {
  id: string;
  body: string;
  createdAt: number;
  synced: boolean;
};

export type OutboxOp = {
  opId: string;
  noteId: string;
  queuedAt: number;
};

export const spikeDb = new Dexie("workout-app-spike") as Dexie & {
  notes: EntityTable<SpikeNote, "id">;
  outbox: EntityTable<OutboxOp, "opId">;
};

spikeDb.version(1).stores({
  notes: "id, createdAt",
  outbox: "opId, queuedAt",
});

/** Saves a note locally and queues it for the server in one transaction. */
export async function addNote(body: string, now = Date.now()) {
  const note: SpikeNote = {
    id: crypto.randomUUID(),
    body,
    createdAt: now,
    synced: false,
  };
  await spikeDb.transaction("rw", spikeDb.notes, spikeDb.outbox, async () => {
    await spikeDb.notes.add(note);
    await spikeDb.outbox.add({
      opId: crypto.randomUUID(),
      noteId: note.id,
      queuedAt: now,
    });
  });
  return note;
}

let pushing: Promise<number> | null = null;

/**
 * Sends queued ops oldest first and drops each one once the server accepts it.
 * Stops at the first failure and leaves the rest queued; the server ignores
 * repeats, so an op that was stored but not acknowledged is safe to resend.
 */
export function pushOutbox(): Promise<number> {
  pushing ??= doPush().finally(() => {
    pushing = null;
  });
  return pushing;
}

async function doPush(): Promise<number> {
  let sent = 0;
  for (const op of await spikeDb.outbox.orderBy("queuedAt").toArray()) {
    const note = await spikeDb.notes.get(op.noteId);
    if (note) {
      const ok = await fetch("/api/spike", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          opId: op.opId,
          id: note.id,
          body: note.body,
          createdAt: note.createdAt,
        }),
      }).then(
        (res) => res.ok,
        () => false,
      );
      if (!ok) break;
    }
    await spikeDb.transaction("rw", spikeDb.notes, spikeDb.outbox, async () => {
      await spikeDb.outbox.delete(op.opId);
      if (note) await spikeDb.notes.update(note.id, { synced: true });
    });
    sent++;
  }
  return sent;
}
