import {
  newId,
  type EntityName,
  type EntityRow,
  type PullResponse,
  type PushResult,
  type SyncOp,
  type UpsertData,
} from "@workout-app/shared";
import { SyncEngine } from "./engine";
import { openLocalDb } from "./local-db";

type Change = { entity: EntityName; row: EntityRow<EntityName> };

/** Mimics /api/sync: op receipts, a global serverSeq and paged pulls (page size 2). */
export function fakeServer() {
  const receipts = new Set<string>();
  const rows = new Map<string, Change>();
  let seq = 0;
  const server = {
    mode: "up" as "up" | "down" | "401" | "lose-response",
    requests: 0,
    rows,
    onPull: undefined as (() => Promise<void>) | undefined,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      server.requests++;
      await Promise.resolve();
      if (server.mode === "down") throw new TypeError("Failed to fetch");
      if (server.mode === "401") return new Response("{}", { status: 401 });
      const url = new URL(input as string, "http://test");
      if (url.pathname === "/api/sync/push") {
        const { ops } = JSON.parse(init?.body as string) as { ops: SyncOp[] };
        const results = ops.map((op): PushResult => {
          if (receipts.has(op.opId))
            return { opId: op.opId, status: "duplicate" };
          if ("name" in op.data && op.data.name === "bad") {
            return { opId: op.opId, status: "rejected", error: "bad name" };
          }
          receipts.add(op.opId);
          seq++;
          const existing = rows.get(op.data.id);
          const row =
            op.action === "upsert"
              ? { ...op.data, userId: 1, serverSeq: seq }
              : {
                  ...existing!.row,
                  deletedAt: op.data.deletedAt,
                  updatedAt: op.data.deletedAt,
                  serverSeq: seq,
                };
          rows.set(op.data.id, { entity: op.entity, row });
          return { opId: op.opId, status: "applied", serverSeq: seq };
        });
        if (server.mode === "lose-response") throw new TypeError("Dropped");
        return Response.json({ results, cursor: seq });
      }
      const onPull = server.onPull;
      server.onPull = undefined;
      await onPull?.();
      const since = Number(url.searchParams.get("since"));
      const newer = [...rows.values()]
        .filter((c) => c.row.serverSeq > since)
        .sort((a, b) => a.row.serverSeq - b.row.serverSeq);
      const changes = newer.slice(0, 2);
      const body: PullResponse = {
        changes: changes as PullResponse["changes"],
        cursor: changes.at(-1)?.row.serverSeq ?? since,
        hasMore: newer.length > 2,
      };
      return Response.json(body);
    },
  };
  return server;
}

export function device(server: ReturnType<typeof fakeServer>) {
  const db = openLocalDb(`test-${newId()}`);
  return { db, engine: new SyncEngine(db, server.fetch) };
}

export function project(name: string, now = 1000): UpsertData<"project"> {
  return {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    name,
    grade: "V4",
    status: "active",
    sentAt: null,
    notes: null,
  };
}
