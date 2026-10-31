import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { createAuth, type AuthOptions } from "./auth.js";
import type { Db } from "./db.js";
import { spikeRoutes } from "./spike.js";

const webDist = process.env.WEB_DIST ?? "../web/dist";

export function createApp(db: Db, options: AuthOptions = {}) {
  const app = new Hono();
  const auth = createAuth(db, options);

  app.get("/healthz", (c) => c.json({ ok: true }));

  // Every /api route needs a session except login (see PUBLIC_PATHS).
  app.use("/api/*", csrf());
  app.use("/api/*", auth.requireSession);
  app.route("/api/auth", auth.routes);
  app.get("/api/hello", (c) => c.json({ message: "Hello, world" }));
  app.route("/api/spike", spikeRoutes(db));
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  app.use("/*", serveStatic({ root: webDist }));
  app.get("/*", serveStatic({ root: webDist, path: "index.html" }));

  return app;
}
