import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { openDb, runMigrations } from "./db.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DATABASE_PATH ?? "data/app.db";

const db = openDb(dbPath);
const { applied, backup } = runMigrations(db);
if (backup) console.log(`Backed up database to ${backup}`);
console.log(`Database ${dbPath}: ${applied} migration(s) applied`);

const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`Server listening on http://${info.address}:${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    db.$client.close();
    process.exit(0);
  });
}
