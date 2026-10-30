import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

const webDist = process.env.WEB_DIST ?? "../web/dist";

export const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true }));
app.get("/api/hello", (c) => c.json({ message: "Hello, world" }));
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

app.use("/*", serveStatic({ root: webDist }));
app.get("/*", serveStatic({ root: webDist, path: "index.html" }));
