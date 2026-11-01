import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { MEDIA_DIRS } from "@workout-app/exercise-data";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { createAuth, type AuthOptions } from "./auth.js";
import type { Db } from "./db.js";
import { syncRoutes } from "./sync.js";

const webDist = process.env.WEB_DIST ?? "../web/dist";

/** Where exercise images are served; media paths are relative to it. */
export const EXERCISE_MEDIA_PATH = "/media/exercises";

export function createApp(db: Db, options: AuthOptions = {}) {
  const app = new Hono();
  const auth = createAuth(db, options);

  app.get("/healthz", (c) => c.json({ ok: true }));

  // Every /api route needs a session except login (see PUBLIC_PATHS).
  app.use("/api/*", csrf());
  app.use("/api/*", auth.requireSession);
  app.route("/api/auth", auth.routes);
  app.get("/api/hello", (c) => c.json({ message: "Hello, world" }));
  app.route("/api/sync", syncRoutes(db, options.now));
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  // Public like the app shell: the images are Unlicense dataset photos.
  app.use(`${EXERCISE_MEDIA_PATH}/*`, async (c, next) => {
    await next();
    if (c.res.ok) c.header("Cache-Control", "public, max-age=86400");
  });
  // Core and other images share one URL space; each folder is tried in turn.
  for (const dir of Object.values(MEDIA_DIRS))
    app.use(
      `${EXERCISE_MEDIA_PATH}/*`,
      serveStatic({
        root: fileURLToPath(dir),
        rewriteRequestPath: (path) => path.slice(EXERCISE_MEDIA_PATH.length),
      }),
    );
  app.all("/media/*", (c) => c.text("Not found", 404));

  app.use("/*", serveStatic({ root: webDist }));
  app.get("/*", serveStatic({ root: webDist, path: "index.html" }));

  return app;
}
