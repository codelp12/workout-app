import { describe, expect, it } from "vitest";
import { app } from "./app.js";

describe("server", () => {
  it("reports healthy on /healthz", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("says hello on /api/hello", async () => {
    const res = await app.request("/api/hello");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Hello, world" });
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});
