import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import {
  FAILED_LOGIN_WINDOW,
  MAX_FAILED_LOGINS,
  SESSION_TTL,
  setPassword,
} from "./auth.js";
import { openDb, runMigrations, type Db } from "./db.js";

const PASSWORD = "correct horse battery";
const DAY = 86_400_000;
const json = { "content-type": "application/json" };

let db: Db;
let clock: number;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  db = openDb(":memory:");
  runMigrations(db);
  clock = 1_800_000_000_000;
  app = createApp(db, { now: () => clock });
  await setPassword(db, PASSWORD);
});

const login = (password: string) =>
  app.request("/api/auth/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ password }),
  });

async function signIn(): Promise<string> {
  const res = await login(PASSWORD);
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

const get = (path: string, cookie?: string) =>
  app.request(path, { headers: cookie ? { cookie } : {} });

describe("server", () => {
  it("reports healthy on /healthz without a session", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("says hello on /api/hello", async () => {
    const res = await get("/api/hello", await signIn());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Hello, world" });
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const res = await get("/api/nope", await signIn());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});

describe("auth", () => {
  it("rejects every /api route except login without a session", async () => {
    for (const [method, path] of [
      ["GET", "/api/hello"],
      ["GET", "/api/nope"],
      ["GET", "/api/spike"],
      ["POST", "/api/spike"],
      ["GET", "/api/auth/session"],
      ["POST", "/api/auth/logout"],
    ] as const) {
      const res = await app.request(path, { method, headers: json });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    const bogus = await get("/api/auth/session", "session=forged");
    expect(bogus.status).toBe(401);
  });

  it("sets an HttpOnly, Secure, SameSite cookie on login", async () => {
    const res = await login(PASSWORD);
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^session=[\w-]{43};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain(`Max-Age=${SESSION_TTL / 1000}`);
    const session = await get("/api/auth/session", cookie.split(";")[0]);
    expect(await session.json()).toEqual({ signedIn: true });
  });

  it("rejects a wrong password and an invalid body", async () => {
    expect((await login("nope")).status).toBe(401);
    const bad = await app.request("/api/auth/login", {
      method: "POST",
      headers: json,
      body: "{",
    });
    expect(bad.status).toBe(400);
  });

  it("rate limits repeated failed logins", async () => {
    for (let i = 0; i < MAX_FAILED_LOGINS; i++)
      expect((await login("nope")).status).toBe(401);
    const locked = await login(PASSWORD);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBe(
      FAILED_LOGIN_WINDOW / 1000,
    );
    clock += FAILED_LOGIN_WINDOW;
    expect((await login(PASSWORD)).status).toBe(200);
  });

  it("slides the session while it's used and expires it after 90 idle days", async () => {
    const cookie = await signIn();
    clock += 60 * DAY;
    const used = await get("/api/auth/session", cookie);
    expect(used.status).toBe(200);
    expect(used.headers.get("set-cookie")).toContain("session=");
    clock += 80 * DAY;
    expect((await get("/api/auth/session", cookie)).status).toBe(200);
    clock += SESSION_TTL;
    expect((await get("/api/auth/session", cookie)).status).toBe(401);
  });

  it("doesn't rewrite the cookie on every request", async () => {
    const cookie = await signIn();
    clock += DAY / 2;
    const res = await get("/api/auth/session", cookie);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("ends the session on logout", async () => {
    const cookie = await signIn();
    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie, origin: "http://localhost" },
    });
    expect(res.status).toBe(200);
    expect((await get("/api/auth/session", cookie)).status).toBe(401);
  });

  it("signs out every session when the password changes", async () => {
    const cookie = await signIn();
    await setPassword(db, "a new password");
    expect((await get("/api/auth/session", cookie)).status).toBe(401);
    expect((await login(PASSWORD)).status).toBe(401);
    expect((await login("a new password")).status).toBe(200);
  });

  it("blocks cross-site form posts", async () => {
    const res = await app.request("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://evil.example",
      },
      body: "password=x",
    });
    expect(res.status).toBe(403);
  });
});

describe("/api/spike", () => {
  const note = {
    opId: "0199f0a0-0000-7000-8000-000000000001",
    id: "0199f0a0-0000-7000-8000-0000000000aa",
    body: "Written offline",
    createdAt: 1_793_450_000_000,
  };
  let cookie: string;
  beforeEach(async () => {
    cookie = await signIn();
  });
  const push = (body: unknown) =>
    app.request("/api/spike", {
      method: "POST",
      headers: { ...json, cookie },
      body: JSON.stringify(body),
    });
  const list = async () =>
    (await (await get("/api/spike", cookie)).json()) as unknown[];

  it("stores a pushed note and lists it", async () => {
    expect(await (await push(note)).json()).toEqual({
      ok: true,
      duplicate: false,
    });
    expect(await list()).toEqual([
      { id: note.id, body: note.body, createdAt: note.createdAt },
    ]);
  });

  it("ignores a retried push with the same op id", async () => {
    await push(note);
    const retry = await push(note);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true, duplicate: true });
    expect(await list()).toHaveLength(1);
  });

  it("rejects invalid notes", async () => {
    expect((await push({ ...note, body: "  " })).status).toBe(400);
    expect((await push({ ...note, opId: "nope" })).status).toBe(400);
    const res = await app.request("/api/spike", {
      method: "POST",
      headers: { ...json, cookie },
      body: "{",
    });
    expect(res.status).toBe(400);
  });
});
