import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const webDist = process.env.WEB_DIST ?? "../web/dist";

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true }));
app.get("/api/hello", (c) => c.json({ message: "Hello, world" }));
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

app.use("/*", serveStatic({ root: webDist }));
app.get("/*", serveStatic({ root: webDist, path: "index.html" }));

serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`Server listening on http://${info.address}:${info.port}`);
});
