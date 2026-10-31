import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { hasPassword } from "./auth.js";
import { databasePath as dbPath, openDb, runMigrations } from "./db.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const secureCookie = process.env.COOKIE_SECURE !== "false";

const db = openDb(dbPath);
const { applied, backup } = runMigrations(db);
if (backup) console.log(`Backed up database to ${backup}`);
console.log(`Database ${dbPath}: ${applied} migration(s) applied`);
if (!hasPassword(db))
  console.warn(
    "No password set, so nobody can sign in. Run `node dist/set-password.js`.",
  );

const server = serve(
  { fetch: createApp(db, { secureCookie }).fetch, hostname: host, port },
  (info) => {
    console.log(`Server listening on http://${info.address}:${info.port}`);
  },
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    db.$client.close();
    process.exit(0);
  });
}
