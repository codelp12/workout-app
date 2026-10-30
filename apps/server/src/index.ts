import { serve } from "@hono/node-server";
import { app } from "./app.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`Server listening on http://${info.address}:${info.port}`);
});
