import {
  ENTITY_NAMES,
  MAX_PUSH_OPS,
  type PullResponse,
  type PushResponse,
  type SyncOp,
} from "@workout-app/shared";
import { dropReplacedProvisional } from "../plan/provisional";
import type { LocalDb, OutboxEntry } from "./local-db";

export type SyncState = "idle" | "syncing" | "offline" | "signed-out" | "error";
type Failure = Exclude<SyncState, "idle" | "syncing">;

const toOp = (e: OutboxEntry) =>
  ({
    opId: e.opId,
    entity: e.entity,
    action: e.action,
    data: e.data,
  }) as SyncOp;

/**
 * Pushes the outbox, then pulls changes since the stored cursor (SPEC §3.2).
 * A failed request (offline, 401, server error) stops the run and leaves the
 * outbox as it was; nothing here ever blocks a local write.
 */
export class SyncEngine {
  private state: SyncState = "idle";
  private readonly listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;

  constructor(
    private readonly db: LocalDb,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = Date.now,
  ) {}

  getState = (): SyncState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Runs a sync. If one is already running, another runs right after it. Never throws. */
  sync = (): Promise<void> => {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.runOnce();
      } while (this.again && this.state === "idle");
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  };

  private setState(state: SyncState) {
    if (state === this.state) return;
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  private async runOnce() {
    this.setState("syncing");
    try {
      this.setState((await this.push()) ?? (await this.pull()) ?? "idle");
    } catch (error) {
      console.error("Sync failed", error);
      this.setState("error");
    }
  }

  private async request(
    path: string,
    init?: RequestInit,
  ): Promise<Response | Failure> {
    let res: Response;
    try {
      res = await this.fetchFn(path, init);
    } catch {
      return "offline";
    }
    if (res.status === 401) return "signed-out";
    return res.ok ? res : "error";
  }

  private async push(): Promise<Failure | undefined> {
    for (;;) {
      const batch = await this.db.outbox
        .orderBy("seq")
        .limit(MAX_PUSH_OPS)
        .toArray();
      if (batch.length === 0) return;
      const res = await this.request("/api/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ops: batch.map(toOp) }),
      });
      if (typeof res === "string") return res;
      const { results } = (await res.json()) as PushResponse;
      const queued = new Map(batch.map((e) => [e.opId, e]));
      const done = results.filter((r) => queued.has(r.opId));
      if (done.length === 0) return "error";
      await this.db.transaction(
        "rw",
        this.db.outbox,
        this.db.rejected,
        async () => {
          for (const result of done) {
            const entry = queued.get(result.opId)!;
            if (result.status === "rejected") {
              await this.db.rejected.put({
                opId: entry.opId,
                op: toOp(entry),
                error: result.error,
                rejectedAt: this.now(),
              });
            }
            await this.db.outbox.delete(entry.seq!);
          }
        },
      );
    }
  }

  private async pull(): Promise<Failure | undefined> {
    const tables = [
      ...ENTITY_NAMES.map((name) => this.db.rows(name)),
      this.db.outbox,
      this.db.meta,
    ];
    for (;;) {
      const since = (await this.db.meta.get("cursor"))?.value ?? 0;
      const res = await this.request(`/api/sync/pull?since=${since}`);
      if (typeof res === "string") return res;
      const page = (await res.json()) as PullResponse;
      await this.db.transaction("rw", tables, async () => {
        for (const { entity, row } of page.changes) {
          // A row with a write still queued keeps the local version. Its push
          // wins on the server and comes back in a later pull.
          const pending = await this.db.outbox
            .where("[entity+rowId]")
            .equals([entity, row.id])
            .count();
          if (!pending) await this.db.rows(entity).put(row);
        }
        await this.db.meta.put({ key: "cursor", value: page.cursor });
      });
      if (!page.hasMore) {
        await dropReplacedProvisional(this.db);
        return;
      }
    }
  }
}

/** The status chip's text (SPEC §3.2). */
export function chipLabel(state: SyncState, pending: number): string {
  const queued = `${pending} pending`;
  const withQueued = (label: string) =>
    pending > 0 ? `${label} · ${queued}` : label;
  if (state === "offline") return withQueued("Offline");
  if (state === "signed-out") return withQueued("Sign in to sync");
  if (state === "error") return withQueued("Sync failed");
  return pending > 0 ? queued : "Synced";
}
