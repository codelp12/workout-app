import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultMigrationsFolder, openDb, runMigrations } from "./db.js";

let dir: string;
let migrations: string;
const entries: {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}[] = [];

function addMigration(tag: string, sql: string) {
  writeFileSync(join(migrations, `${tag}.sql`), sql);
  entries.push({
    idx: entries.length,
    version: "6",
    when: 1_700_000_000_000 + entries.length,
    tag,
    breakpoints: true,
  });
  writeFileSync(
    join(migrations, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "sqlite", entries }),
  );
}

function tables(db: ReturnType<typeof openDb>) {
  return db.$client
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((r) => r.name);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "db-test-"));
  migrations = join(dir, "migrations");
  mkdirSync(join(migrations, "meta"), { recursive: true });
  entries.length = 0;
  addMigration(
    "0000_notes",
    "CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL);",
  );
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("runMigrations", () => {
  it("migrates a fresh in-memory DB", () => {
    const db = openDb(":memory:");
    expect(runMigrations(db, migrations)).toEqual({ applied: 1, backup: null });
    expect(tables(db)).toEqual(["notes"]);
  });

  it("applies only new migrations to an existing DB and is idempotent", () => {
    const db = openDb(":memory:");
    runMigrations(db, migrations);
    db.$client.prepare("INSERT INTO notes VALUES ('a', 'kept')").run();

    addMigration("0001_tags", "CREATE TABLE tags (id TEXT PRIMARY KEY);");
    expect(runMigrations(db, migrations).applied).toBe(1);
    expect(runMigrations(db, migrations).applied).toBe(0);
    expect(tables(db)).toEqual(["notes", "tags"]);
    expect(db.$client.prepare("SELECT body FROM notes").pluck().get()).toBe(
      "kept",
    );
  });

  it("backs up an existing file DB before migrating it", () => {
    const file = join(dir, "data", "app.db");
    let db = openDb(file);
    expect(runMigrations(db, migrations).backup).toBeNull();
    db.$client.prepare("INSERT INTO notes VALUES ('a', 'before')").run();
    db.$client.close();

    addMigration("0001_tags", "CREATE TABLE tags (id TEXT PRIMARY KEY);");
    db = openDb(file);
    const { applied, backup } = runMigrations(db, migrations);
    db.$client.close();

    expect(applied).toBe(1);
    expect(backup).toMatch(/data\/backups\/app-pre-migrate-.+\.db$/);
    const copy = new Database(backup!, { readonly: true });
    expect(copy.prepare("SELECT body FROM notes").pluck().get()).toBe("before");
    expect(
      copy.prepare("SELECT name FROM sqlite_master WHERE name = 'tags'").get(),
    ).toBeUndefined();
    copy.close();
  });

  it("writes no backup when nothing is pending", () => {
    const file = join(dir, "app.db");
    const db = openDb(file);
    runMigrations(db, migrations);
    db.$client.prepare("INSERT INTO notes VALUES ('a', 'x')").run();
    expect(runMigrations(db, migrations).backup).toBeNull();
    expect(existsSync(join(dir, "backups"))).toBe(false);
    db.$client.close();
  });

  it("rolls back a failing migration", () => {
    const db = openDb(":memory:");
    runMigrations(db, migrations);
    addMigration(
      "0001_bad",
      "CREATE TABLE ok (id TEXT);\n--> statement-breakpoint\nNOT VALID SQL;",
    );
    expect(() => runMigrations(db, migrations)).toThrow();
    expect(tables(db)).toEqual(["notes"]);
  });

  it("loads the app's own migrations", () => {
    const db = openDb(":memory:");
    expect(() => runMigrations(db, defaultMigrationsFolder)).not.toThrow();
  });
});
