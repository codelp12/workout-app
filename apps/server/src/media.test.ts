import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { openDb, runMigrations } from "./db.js";

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  const db = openDb(":memory:");
  runMigrations(db);
  app = createApp(db);
});

describe("GET /media/exercises/*", () => {
  it("serves core images without a session", async () => {
    const res = await app.request("/media/exercises/Pushups/0.webp");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WEBP");
  });

  it("returns 404, not the app shell, for missing media", async () => {
    for (const path of [
      "/media/exercises/Not_An_Exercise/0.webp",
      "/media/other.png",
      "/media/exercises/..%2F..%2Fpackage.json",
      "/media/exercises/%2e%2e/%2e%2e/package.json",
    ]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("content-type"), path).not.toMatch(/html/);
    }
  });
});
