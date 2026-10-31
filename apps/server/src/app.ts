import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Db } from "./db.js";
import { spikeRoutes } from "./spike.js";

const webDist = process.env.WEB_DIST ?? "../web/dist";

export function createApp(db: Db) {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/api/hello", (c) => c.json({ message: "Hello, world" }));
  app.route("/api/spike", spikeRoutes(db));
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  app.use("/*", serveStatic({ root: webDist }));
  app.get("/*", serveStatic({ root: webDist, path: "index.html" }));

  return app;
}
