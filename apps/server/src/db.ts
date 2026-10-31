import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

export const defaultMigrationsFolder = fileURLToPath(
  new URL("../drizzle", import.meta.url),
);

const MEMORY = ":memory:";

/** Opens the SQLite file at `path` (created if missing), or an in-memory DB for `:memory:`. */
export function openDb(path: string): Db {
  if (path !== MEMORY) mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return drizzle(sqlite, { schema });
}

function pendingMigrations(db: Db, migrationsFolder: string): number {
  const migrations = readMigrationFiles({ migrationsFolder });
  const hasTable = db.$client
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get();
  const last = hasTable
    ? db.$client
        .prepare<[], { last: number | null }>(
          "SELECT MAX(created_at) AS last FROM __drizzle_migrations",
        )
        .get()?.last
    : null;
  // Same rule as Drizzle's migrator: anything newer than the last applied one runs.
  return migrations.filter((m) => last == null || m.folderMillis > Number(last))
    .length;
}

function userTableCount(db: Db): number {
  const row = db.$client
    .prepare<[], { n: number }>(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .get();
  return row?.n ?? 0;
}

/** Copies the DB to `<dir>/backups/<name>-pre-migrate-<timestamp>.db` and returns the path. */
export function backupDb(db: Db, now = new Date()): string {
  const file = db.$client.name;
  const name = basename(file, extname(file));
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const target = join(
    dirname(file),
    "backups",
    `${name}-pre-migrate-${stamp}.db`,
  );
  mkdirSync(dirname(target), { recursive: true });
  db.$client.prepare("VACUUM INTO ?").run(target);
  return target;
}

export type MigrateResult = { applied: number; backup: string | null };

/**
 * Applies pending forward-only migrations in one transaction. If a file DB
 * already has tables, it is copied first (SPEC §8) so a bad migration can be
 * rolled back by restoring the copy.
 */
export function runMigrations(
  db: Db,
  migrationsFolder = defaultMigrationsFolder,
): MigrateResult {
  const pending = pendingMigrations(db, migrationsFolder);
  if (pending === 0) return { applied: 0, backup: null };
  const isFile = db.$client.name !== MEMORY && existsSync(db.$client.name);
  const backup = isFile && userTableCount(db) > 0 ? backupDb(db) : null;
  migrate(db, { migrationsFolder });
  return { applied: pending, backup };
}
