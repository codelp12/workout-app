// Drizzle table definitions. Run `pnpm --filter @workout-app/server db:generate`
// after changing this file and commit the generated migration in `drizzle/`.
//
// Synced tables mirror the zod schemas in @workout-app/shared field for field
// (schema.test.ts checks this). Imports from shared must stay type-only:
// drizzle-kit loads this file without the workspace source condition.
import type {
  AscentStyle,
  DayAvailability,
  DaySlot,
  DistanceUnit,
  ElevationUnit,
  Equipment,
  Goals,
  IntensityClass,
  Intent,
  Mechanic,
  Media,
  Modality,
  OverrideKind,
  PlannedItemKind,
  PlannedStatus,
  ProgressionModel,
  ProjectStatus,
  RunSplit,
  StressTag,
  TemplateSlot,
  WeekType,
  Weight,
  WeightUnit,
} from "@workout-app/shared";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// Throwaway Phase 0 spike (#21). Kept until the iPhone check (#24) has run;
// the client sync engine (#28) replaces it.
export const spikeNotes = sqliteTable("spike_note", {
  id: text("id").primaryKey(),
  opId: text("op_id").notNull().unique(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
  receivedAt: integer("received_at").notNull(),
});

// Single-user sign-in (#29). One row, id 1.
export const account = sqliteTable("account", {
  id: integer("id").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// `id` is the SHA-256 of the cookie token, so a copy of the DB can't be used to sign in.
export const authSession = sqliteTable("auth_session", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

// --- Synced entities (SPEC §4) ----------------------------------------------
// No foreign keys: rows arrive through sync ops that must never wedge the
// outbox on ordering, and deletes are tombstones. Parent ids are indexed.

const syncColumns = () => ({
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
  serverSeq: integer("server_seq").notNull(),
});

const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();
const bool = (name: string) => integer(name, { mode: "boolean" });

export const settings = sqliteTable(
  "settings",
  {
    ...syncColumns(),
    weightUnit: text("weight_unit").$type<WeightUnit>().notNull(),
    distanceUnit: text("distance_unit").$type<DistanceUnit>().notNull(),
    timezone: text("timezone").notNull(),
    equipment: json<Equipment>("equipment").notNull(),
    availability: json<DayAvailability[]>("availability").notNull(),
    longRunDay: integer("long_run_day"),
    liftFreeDay: integer("lift_free_day"),
    goals: json<Goals>("goals").notNull(),
    engineConfig: json<Record<string, unknown>>("engine_config").notNull(),
  },
  (t) => [index("settings_server_seq_idx").on(t.serverSeq)],
);

export const exercise = sqliteTable(
  "exercise",
  {
    ...syncColumns(),
    name: text("name").notNull(),
    aliases: json<string[]>("aliases").notNull(),
    modality: text("modality").$type<Modality>().notNull(),
    movementPattern: text("movement_pattern"),
    primaryMuscles: json<string[]>("primary_muscles").notNull(),
    secondaryMuscles: json<string[]>("secondary_muscles").notNull(),
    equipment: json<string[]>("equipment").notNull(),
    mechanic: text("mechanic").$type<Mechanic>(),
    unilateral: bool("unilateral").notNull(),
    progressionModel: text("progression_model").$type<ProgressionModel>(),
    increment: json<Weight>("increment"),
    repMin: integer("rep_min"),
    repMax: integer("rep_max"),
    stressTags: json<StressTag[]>("stress_tags").notNull(),
    substitutionGroup: text("substitution_group"),
    instructions: json<string[]>("instructions").notNull(),
    cues: json<string[]>("cues").notNull(),
    commonMistakes: json<string[]>("common_mistakes").notNull(),
    media: json<Media[]>("media").notNull(),
    source: text("source").notNull(),
    license: text("license").notNull(),
    sourceId: text("source_id"),
  },
  (t) => [
    index("exercise_server_seq_idx").on(t.serverSeq),
    index("exercise_substitution_group_idx").on(t.substitutionGroup),
  ],
);

export const template = sqliteTable(
  "template",
  {
    ...syncColumns(),
    name: text("name").notNull(),
    modality: text("modality").$type<Modality>().notNull(),
    intensityClass: text("intensity_class").$type<IntensityClass>().notNull(),
    intent: text("intent").$type<Intent>().notNull(),
    slots: json<TemplateSlot[]>("slots").notNull(),
  },
  (t) => [index("template_server_seq_idx").on(t.serverSeq)],
);

export const block = sqliteTable(
  "block",
  {
    ...syncColumns(),
    name: text("name"),
    startDate: text("start_date").notNull(),
    weekCount: integer("week_count").notNull(),
    engineVersion: text("engine_version").notNull(),
  },
  (t) => [index("block_server_seq_idx").on(t.serverSeq)],
);

export const week = sqliteTable(
  "week",
  {
    ...syncColumns(),
    blockId: text("block_id").notNull(),
    index: integer("index").notNull(),
    startDate: text("start_date").notNull(),
    type: text("type").$type<WeekType>().notNull(),
    engineVersion: text("engine_version").notNull(),
  },
  (t) => [
    index("week_server_seq_idx").on(t.serverSeq),
    index("week_block_id_idx").on(t.blockId),
    index("week_start_date_idx").on(t.startDate),
  ],
);

export const plannedSession = sqliteTable(
  "planned_session",
  {
    ...syncColumns(),
    weekId: text("week_id"),
    date: text("date").notNull(),
    slot: text("slot").$type<DaySlot>().notNull(),
    modality: text("modality").$type<Modality>().notNull(),
    workoutType: text("workout_type").notNull(),
    templateId: text("template_id"),
    intent: text("intent").$type<Intent>().notNull(),
    status: text("status").$type<PlannedStatus>().notNull(),
    generatedBy: text("generated_by").notNull(),
  },
  (t) => [
    index("planned_session_server_seq_idx").on(t.serverSeq),
    index("planned_session_week_id_idx").on(t.weekId),
    index("planned_session_date_idx").on(t.date),
  ],
);

export const plannedItem = sqliteTable(
  "planned_item",
  {
    ...syncColumns(),
    plannedSessionId: text("planned_session_id").notNull(),
    position: integer("position").notNull(),
    kind: text("kind").$type<PlannedItemKind>().notNull(),
    exerciseId: text("exercise_id"),
    targets: json<Record<string, unknown>>("targets").notNull(),
    reasons: json<string[]>("reasons").notNull(),
  },
  (t) => [
    index("planned_item_server_seq_idx").on(t.serverSeq),
    index("planned_item_planned_session_id_idx").on(t.plannedSessionId),
  ],
);

export const planOverride = sqliteTable(
  "plan_override",
  {
    ...syncColumns(),
    kind: text("kind").$type<OverrideKind>().notNull(),
    plannedSessionId: text("planned_session_id"),
    weekId: text("week_id"),
    data: json<Record<string, unknown>>("data").notNull(),
    opId: text("op_id").notNull(),
    supersededAt: integer("superseded_at"),
  },
  (t) => [
    index("plan_override_server_seq_idx").on(t.serverSeq),
    index("plan_override_planned_session_id_idx").on(t.plannedSessionId),
    index("plan_override_week_id_idx").on(t.weekId),
  ],
);

export const sessionLog = sqliteTable(
  "session_log",
  {
    ...syncColumns(),
    plannedSessionId: text("planned_session_id"),
    modality: text("modality").$type<Modality>().notNull(),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    localDate: text("local_date").notNull(),
    timezone: text("timezone").notNull(),
    rpe: integer("rpe"),
    notes: text("notes"),
  },
  (t) => [
    index("session_log_server_seq_idx").on(t.serverSeq),
    index("session_log_planned_session_id_idx").on(t.plannedSessionId),
    index("session_log_local_date_idx").on(t.localDate),
  ],
);

export const setLog = sqliteTable(
  "set_log",
  {
    ...syncColumns(),
    sessionLogId: text("session_log_id").notNull(),
    exerciseId: text("exercise_id").notNull(),
    index: integer("index").notNull(),
    loadValue: real("load_value"),
    loadUnit: text("load_unit").$type<WeightUnit>(),
    band: text("band"),
    reps: integer("reps").notNull(),
    rir: integer("rir"),
    isWarmup: bool("is_warmup").notNull(),
    completedAt: integer("completed_at"),
  },
  (t) => [
    index("set_log_server_seq_idx").on(t.serverSeq),
    index("set_log_session_log_id_idx").on(t.sessionLogId),
    index("set_log_exercise_id_idx").on(t.exerciseId),
  ],
);

export const runLog = sqliteTable(
  "run_log",
  {
    ...syncColumns(),
    sessionLogId: text("session_log_id").notNull(),
    workoutType: text("workout_type").notNull(),
    distanceValue: real("distance_value"),
    distanceUnit: text("distance_unit").$type<DistanceUnit>().notNull(),
    durationSec: integer("duration_sec"),
    avgHr: integer("avg_hr"),
    elevationValue: real("elevation_value"),
    elevationUnit: text("elevation_unit").$type<ElevationUnit>(),
    rpe: integer("rpe"),
    splits: json<RunSplit[]>("splits").notNull(),
  },
  (t) => [
    index("run_log_server_seq_idx").on(t.serverSeq),
    index("run_log_session_log_id_idx").on(t.sessionLogId),
  ],
);

export const project = sqliteTable(
  "project",
  {
    ...syncColumns(),
    name: text("name").notNull(),
    grade: text("grade").notNull(),
    status: text("status").$type<ProjectStatus>().notNull(),
    sentAt: integer("sent_at"),
    notes: text("notes"),
  },
  (t) => [index("project_server_seq_idx").on(t.serverSeq)],
);

export const ascent = sqliteTable(
  "ascent",
  {
    ...syncColumns(),
    sessionLogId: text("session_log_id").notNull(),
    projectId: text("project_id"),
    grade: text("grade").notNull(),
    style: text("style").$type<AscentStyle>().notNull(),
    attempts: integer("attempts").notNull(),
    tags: json<string[]>("tags").notNull(),
  },
  (t) => [
    index("ascent_server_seq_idx").on(t.serverSeq),
    index("ascent_session_log_id_idx").on(t.sessionLogId),
    index("ascent_project_id_idx").on(t.projectId),
  ],
);

/** Client op ids the server has already applied, so a replayed push is a no-op (§3.2). Server-only. */
export const opReceipt = sqliteTable("op_receipt", {
  opId: text("op_id").primaryKey(),
  userId: integer("user_id").notNull(),
  receivedAt: integer("received_at").notNull(),
});
