import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ENTITY_NAMES,
  entitySchemas,
  newId,
  type EntityName,
  type EntityRow,
} from "@workout-app/shared";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultMigrationsFolder,
  openDb,
  runMigrations,
  type Db,
} from "./db.js";
import * as schema from "./schema.js";

const tables = {
  settings: schema.settings,
  exercise: schema.exercise,
  template: schema.template,
  block: schema.block,
  week: schema.week,
  planned_session: schema.plannedSession,
  planned_item: schema.plannedItem,
  plan_override: schema.planOverride,
  session_log: schema.sessionLog,
  set_log: schema.setLog,
  run_log: schema.runLog,
  project: schema.project,
  ascent: schema.ascent,
} satisfies Record<EntityName, SQLiteTable>;

// Compile-time check that each table's row type is exactly its zod type.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type RowsMatch = {
  [E in EntityName]: Equal<(typeof tables)[E]["$inferSelect"], EntityRow<E>>;
};
const rowsMatch: RowsMatch = {
  settings: true,
  exercise: true,
  template: true,
  block: true,
  week: true,
  planned_session: true,
  planned_item: true,
  plan_override: true,
  session_log: true,
  set_log: true,
  run_log: true,
  project: true,
  ascent: true,
};

const now = Date.UTC(2026, 9, 31, 14);
const base = () => ({
  id: newId(),
  userId: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  serverSeq: 1,
});
const exerciseId = newId();
const sessionLogId = newId();

// One valid row per entity, with JSON, boolean and nullable columns filled in.
const fixtures: { [E in EntityName]: EntityRow<E> } = {
  settings: {
    ...base(),
    weightUnit: "lb",
    distanceUnit: "mi",
    timezone: "America/New_York",
    equipment: {
      dumbbells: { min: 5, max: 120, step: 5 },
      barbells: [20, 30, 40],
      bands: ["light", "medium", "heavy"],
      bar: null,
      plates: [],
      stackStep: null,
    },
    availability: [{ weekday: 1, am: true, pm: false, gym: true }],
    longRunDay: 7,
    liftFreeDay: 3,
    goals: {
      race: null,
      targetLifts: [{ exerciseId, load: { value: 80, unit: "lb" }, reps: 8 }],
    },
    engineConfig: { deloadEvery: 4 },
  },
  exercise: {
    ...base(),
    id: exerciseId,
    name: "Dumbbell Bench Press",
    aliases: ["DB bench"],
    modality: "lift",
    movementPattern: "horizontal_push",
    primaryMuscles: ["chest"],
    secondaryMuscles: ["triceps", "shoulders"],
    equipment: ["dumbbell"],
    mechanic: "compound",
    unilateral: false,
    progressionModel: "e1rm_rir",
    increment: { value: 5, unit: "lb" },
    repMin: 6,
    repMax: 10,
    stressTags: ["shoulder", "elbow"],
    substitutionGroup: "horizontal_press",
    instructions: ["Lie on the bench.", "Press."],
    cues: ["Shoulder blades back"],
    commonMistakes: ["Flared elbows"],
    media: [
      {
        kind: "image",
        path: "exercises/db-bench/0.webp",
        source: "free-exercise-db",
        license: "Unlicense",
      },
    ],
    source: "free-exercise-db@abc123",
    license: "Unlicense",
    sourceId: "Dumbbell_Bench_Press",
  },
  template: {
    ...base(),
    name: "Push A",
    modality: "lift",
    intensityClass: "heavy",
    intent: "key",
    slots: [
      {
        exerciseId,
        substitutionGroup: null,
        sets: 3,
        repMin: 6,
        repMax: 10,
        targetRir: 2,
        restSec: 150,
        ramp: true,
      },
    ],
  },
  block: {
    ...base(),
    name: null,
    startDate: "2026-11-02",
    weekCount: 4,
    engineVersion: "0.0.0",
  },
  week: {
    ...base(),
    blockId: newId(),
    index: 0,
    startDate: "2026-11-02",
    type: "loading",
    engineVersion: "0.0.0",
  },
  planned_session: {
    ...base(),
    weekId: null,
    date: "2026-11-02",
    slot: "am",
    modality: "lift",
    workoutType: "push_a",
    templateId: null,
    intent: "key",
    status: "planned",
    generatedBy: "manual",
  },
  planned_item: {
    ...base(),
    plannedSessionId: newId(),
    position: 0,
    kind: "exercise",
    exerciseId,
    targets: { sets: 3, reps: 8 },
    reasons: ["Week 1 of the block"],
  },
  plan_override: {
    ...base(),
    kind: "move",
    plannedSessionId: newId(),
    weekId: null,
    data: { toDate: "2026-11-03" },
    opId: newId(),
    supersededAt: null,
  },
  session_log: {
    ...base(),
    id: sessionLogId,
    plannedSessionId: null,
    modality: "lift",
    startedAt: now,
    endedAt: now + 3_600_000,
    localDate: "2026-10-31",
    timezone: "America/New_York",
    rpe: 7,
    notes: "Felt good",
  },
  set_log: {
    ...base(),
    sessionLogId,
    exerciseId,
    index: 0,
    loadValue: 62.5,
    loadUnit: "lb",
    band: null,
    reps: 8,
    rir: 2,
    isWarmup: false,
    completedAt: now,
  },
  run_log: {
    ...base(),
    sessionLogId,
    workoutType: "easy",
    distanceValue: 3.1,
    distanceUnit: "mi",
    durationSec: 1800,
    avgHr: null,
    elevationValue: null,
    elevationUnit: null,
    rpe: 4,
    splits: [{ distanceValue: 1, durationSec: 580 }],
  },
  project: {
    ...base(),
    name: "Blue overhang",
    grade: "V5",
    status: "active",
    sentAt: null,
    notes: null,
  },
  ascent: {
    ...base(),
    sessionLogId,
    projectId: null,
    grade: "V4",
    style: "flash",
    attempts: 1,
    tags: ["crimp"],
  },
};

function insertFixtures(db: Db) {
  for (const name of ENTITY_NAMES) {
    db.insert(tables[name])
      .values(fixtures[name] as never)
      .run();
  }
}

describe("core schema", () => {
  it("has a table for every shared entity, with the same fields", () => {
    expect(Object.values(rowsMatch).every(Boolean)).toBe(true);
    for (const name of ENTITY_NAMES) {
      expect(getTableName(tables[name])).toBe(name);
      expect(Object.keys(getTableColumns(tables[name])).sort()).toEqual(
        Object.keys(entitySchemas[name].shape).sort(),
      );
    }
  });

  it("fixtures are valid rows", () => {
    for (const name of ENTITY_NAMES) {
      expect(() => entitySchemas[name].parse(fixtures[name])).not.toThrow();
    }
  });

  it("round-trips every entity through SQLite", () => {
    const db = openDb(":memory:");
    runMigrations(db);
    insertFixtures(db);
    for (const name of ENTITY_NAMES) {
      const rows = db.select().from(tables[name]).all();
      expect(rows).toEqual([fixtures[name]]);
      expect(entitySchemas[name].parse(rows[0])).toEqual(fixtures[name]);
    }
  });

  it("rejects invalid rows", () => {
    expect(
      entitySchemas.set_log.safeParse({ ...fixtures.set_log, rir: -1 }).success,
    ).toBe(false);
    expect(
      entitySchemas.exercise.safeParse({
        ...fixtures.exercise,
        stressTags: ["toe"],
      }).success,
    ).toBe(false);
    expect(
      entitySchemas.template.safeParse({
        ...fixtures.template,
        slots: [
          {
            ...fixtures.template.slots[0],
            exerciseId: null,
            substitutionGroup: null,
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("core schema migration", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "schema-test-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** Copies the app's migrations up to and including `lastTag` into a temp folder. */
  function migrationsUpTo(lastTag: string) {
    const folder = join(dir, "migrations");
    mkdirSync(join(folder, "meta"), { recursive: true });
    const journal = JSON.parse(
      readFileSync(
        join(defaultMigrationsFolder, "meta", "_journal.json"),
        "utf8",
      ),
    ) as { entries: { tag: string }[] };
    const last = journal.entries.findIndex((e) => e.tag === lastTag);
    expect(last).toBeGreaterThanOrEqual(0);
    journal.entries = journal.entries.slice(0, last + 1);
    for (const { tag } of journal.entries) {
      copyFileSync(
        join(defaultMigrationsFolder, `${tag}.sql`),
        join(folder, `${tag}.sql`),
      );
    }
    writeFileSync(
      join(folder, "meta", "_journal.json"),
      JSON.stringify(journal),
    );
    return folder;
  }

  it("upgrades a seeded pre-schema database without losing data", () => {
    const file = join(dir, "app.db");
    let db = openDb(file);
    runMigrations(db, migrationsUpTo("0001_auth"));
    db.insert(schema.account)
      .values({ id: 1, passwordHash: "$argon2id$x", updatedAt: now })
      .run();
    db.insert(schema.authSession)
      .values({ id: "h", createdAt: now, expiresAt: now + 1 })
      .run();
    db.insert(schema.spikeNotes)
      .values({
        id: newId(),
        opId: newId(),
        body: "kept",
        createdAt: now,
        receivedAt: now,
      })
      .run();
    db.$client.close();

    db = openDb(file);
    const { applied, backup } = runMigrations(db);
    expect(applied).toBeGreaterThanOrEqual(1);
    expect(backup).not.toBeNull();
    expect(db.select().from(schema.account).all()).toHaveLength(1);
    expect(db.select().from(schema.authSession).all()).toHaveLength(1);
    expect(
      db.select({ body: schema.spikeNotes.body }).from(schema.spikeNotes).all(),
    ).toEqual([{ body: "kept" }]);
    insertFixtures(db);
    expect(db.select().from(schema.setLog).all()).toEqual([fixtures.set_log]);
    db.$client.close();
  });
});
