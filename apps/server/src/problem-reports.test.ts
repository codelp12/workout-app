import { newId, type PullResponse, type UpsertData } from "@workout-app/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { setPassword } from "./auth.js";
import { openDb, runMigrations, type Db } from "./db.js";
import { formatReports, markFiled, newReports } from "./problem-reports.js";

const PASSWORD = "correct horse battery";
const T0 = Date.UTC(2026, 10, 10, 17);
const json = { "content-type": "application/json" };

let db: Db;
let app: ReturnType<typeof createApp>;
let cookie: string;

beforeEach(async () => {
  db = openDb(":memory:");
  runMigrations(db);
  app = createApp(db, { now: () => T0, planWeeks: false });
  await setPassword(db, PASSWORD);
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ password: PASSWORD }),
  });
  cookie = res.headers.get("set-cookie")!.split(";")[0]!;
});

const report = (
  fields: Partial<UpsertData<"problem_report">> = {},
): UpsertData<"problem_report"> => ({
  id: newId(),
  createdAt: T0,
  updatedAt: T0,
  deletedAt: null,
  text: "The rest timer kept going after I finished.",
  appBuild: "2026-11-10T16:00Z",
  screen: "/session/abc",
  userAgent: "Mozilla/5.0 (iPhone)",
  syncStatus: "Offline · 2 pending",
  status: "new",
  githubIssue: null,
  ...fields,
});

async function push(...reports: UpsertData<"problem_report">[]) {
  const res = await app.request("/api/sync/push", {
    method: "POST",
    headers: { ...json, cookie },
    body: JSON.stringify({
      ops: reports.map((data) => ({
        opId: newId(),
        entity: "problem_report",
        action: "upsert",
        data,
      })),
    }),
  });
  expect(res.status).toBe(200);
}

async function pull(since: number): Promise<PullResponse> {
  const res = await app.request(`/api/sync/pull?since=${since}`, {
    headers: { cookie },
  });
  return (await res.json()) as PullResponse;
}

describe("problem reports", () => {
  it("lists reports pushed through sync, oldest first, as Markdown", async () => {
    const later = report({ createdAt: T0 + 60_000, text: "Second" });
    const first = report({ text: "First" });
    await push(later, first);

    expect(newReports(db).map((r) => r.text)).toEqual(["First", "Second"]);
    const markdown = formatReports(newReports(db));
    expect(markdown).toContain(`## Report ${first.id.slice(-8)}\n\nFirst`);
    expect(markdown).toContain("- Screen: /session/abc");
    expect(markdown).toContain("- Sync status: Offline · 2 pending");
    expect(markdown).toContain("- Reported: 2026-11-10T17:00:00.000Z");
  });

  it("says when there's nothing new", () => {
    expect(formatReports(newReports(db))).toBe("No new problem reports.");
  });

  it("rejects an empty report", async () => {
    const res = await app.request("/api/sync/push", {
      method: "POST",
      headers: { ...json, cookie },
      body: JSON.stringify({
        ops: [
          {
            opId: newId(),
            entity: "problem_report",
            action: "upsert",
            data: report({ text: "" }),
          },
        ],
      }),
    });
    const body = (await res.json()) as { results: { status: string }[] };
    expect(body.results[0]?.status).toBe("rejected");
    expect(newReports(db)).toEqual([]);
  });

  it("marks a report filed by its short id (the end of its id), so it leaves the list and syncs back", async () => {
    const filed = report();
    const kept = report({ text: "Still new" });
    await push(filed, kept);
    const { cursor } = await pull(0);

    const result = markFiled(db, filed.id.slice(-8), 112, T0 + 1000);
    expect(result.ok).toBe(true);
    expect(newReports(db).map((r) => r.id)).toEqual([kept.id]);

    const { changes } = await pull(cursor);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.row).toMatchObject({
      id: filed.id,
      status: "filed",
      githubIssue: 112,
      updatedAt: T0 + 1000,
    });
  });

  it("refuses a too-short, unknown or ambiguous id and a bad issue number", async () => {
    const a = report({ id: "00000000-0000-4000-8000-00010123abcd" });
    const b = report({ id: "00000000-0000-4000-8000-00020123abcd" });
    await push(a, b);

    expect(markFiled(db, "abcd", 1)).toMatchObject({ ok: false });
    expect(markFiled(db, "ffffffff", 1)).toMatchObject({
      ok: false,
      error: "No report id ends with ffffffff.",
    });
    expect(markFiled(db, "0123abcd", 1)).toMatchObject({
      ok: false,
      error:
        "More than one report id ends with 0123abcd; give more characters.",
    });
    expect(markFiled(db, a.id, 0)).toMatchObject({ ok: false });
    expect(markFiled(db, a.id.toUpperCase(), 7)).toMatchObject({ ok: true });
    expect(newReports(db).map((r) => r.id)).toEqual([b.id]);
  });
});
