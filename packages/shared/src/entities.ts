// Phase 1 entities (SPEC §4) as zod schemas: the shapes that sync between the
// clients and the server (§3.2). The server's Drizzle tables in
// apps/server/src/schema.ts mirror these field for field.
import { z } from "zod";

export const WEIGHT_UNITS = ["lb", "kg"] as const;
export const DISTANCE_UNITS = ["mi", "km"] as const;
export const ELEVATION_UNITS = ["ft", "m"] as const;
export const MODALITIES = ["lift", "run", "climb", "mobility"] as const;
/** Shared body-region list for exercise stress tags and pain flags (§4, §5.5). */
export const STRESS_TAGS = [
  "neck",
  "shoulder",
  "elbow",
  "wrist",
  "fingers",
  "upper_back",
  "low_back",
  "hip",
  "knee",
  "shin",
  "ankle_foot",
] as const;
export const PROGRESSION_MODELS = ["e1rm_rir", "double_progression"] as const;
export const MECHANICS = ["compound", "isolation"] as const;
export const INTENSITY_CLASSES = ["heavy", "moderate", "light"] as const;
export const INTENTS = ["key", "support", "recovery"] as const;
export const WEEK_TYPES = ["loading", "deload", "taper", "test"] as const;
export const DAY_SLOTS = ["am", "pm"] as const;
export const PLANNED_STATUSES = [
  "planned",
  "done",
  "skipped",
  "moved",
] as const;
export const PLANNED_ITEM_KINDS = [
  "exercise",
  "run_segment",
  "climb_block",
] as const;
export const OVERRIDE_KINDS = [
  "move",
  "trim",
  "swap",
  "provisional_week",
] as const;
export const ASCENT_STYLES = ["flash", "onsight", "send", "attempt"] as const;
export const PROJECT_STATUSES = ["active", "sent", "dropped"] as const;
export const MEDIA_KINDS = ["image", "video"] as const;

export type WeightUnit = (typeof WEIGHT_UNITS)[number];
export type DistanceUnit = (typeof DISTANCE_UNITS)[number];
export type ElevationUnit = (typeof ELEVATION_UNITS)[number];
export type Modality = (typeof MODALITIES)[number];
export type StressTag = (typeof STRESS_TAGS)[number];
export type ProgressionModel = (typeof PROGRESSION_MODELS)[number];
export type Mechanic = (typeof MECHANICS)[number];
export type IntensityClass = (typeof INTENSITY_CLASSES)[number];
export type Intent = (typeof INTENTS)[number];
export type WeekType = (typeof WEEK_TYPES)[number];
export type DaySlot = (typeof DAY_SLOTS)[number];
export type PlannedStatus = (typeof PLANNED_STATUSES)[number];
export type PlannedItemKind = (typeof PLANNED_ITEM_KINDS)[number];
export type OverrideKind = (typeof OVERRIDE_KINDS)[number];
export type AscentStyle = (typeof ASCENT_STYLES)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Milliseconds since the epoch, UTC. */
const timestamp = z.int().nonnegative();
/** Local calendar date, `YYYY-MM-DD`. */
const localDate = z.iso.date();
/** ISO weekday: 1 = Monday … 7 = Sunday. */
const weekday = z.int().min(1).max(7);
const count = z.int().nonnegative();
const rpe = z.int().min(1).max(10);
const rir = z.int().min(0).max(10);

export const weightSchema = z.object({
  value: z.number().nonnegative(),
  unit: z.enum(WEIGHT_UNITS),
});
export type Weight = z.infer<typeof weightSchema>;

/** Columns every synced row carries (§3.2, §4). */
const syncFields = {
  id: z.uuid(),
  userId: z.int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: timestamp.nullable(),
  /** Assigned by the server on every accepted write; 0 until first synced. */
  serverSeq: count,
};

// --- Settings ---------------------------------------------------------------

/** Weights are in the settings' `weightUnit`. */
export const equipmentSchema = z.object({
  dumbbells: z
    .object({
      min: z.number().positive(),
      max: z.number().positive(),
      step: z.number().positive(),
    })
    .nullable(),
  /** Fixed-weight barbells. */
  barbells: z.array(z.number().positive()),
  /** Band names, lightest first. */
  bands: z.array(z.string().min(1)),
  /** Optional loadable barbell: bar weight plus plates available per side. */
  bar: z.number().positive().nullable(),
  plates: z.array(z.number().positive()),
  /** Cable or machine stack step, if ever configured. */
  stackStep: z.number().positive().nullable(),
});
export type Equipment = z.infer<typeof equipmentSchema>;

export const dayAvailabilitySchema = z.object({
  weekday,
  am: z.boolean(),
  pm: z.boolean(),
  gym: z.boolean(),
});
export type DayAvailability = z.infer<typeof dayAvailabilitySchema>;

export const goalsSchema = z.object({
  race: z
    .object({
      name: z.string(),
      date: localDate,
      distanceValue: z.number().positive(),
      distanceUnit: z.enum(DISTANCE_UNITS),
    })
    .nullable(),
  targetLifts: z.array(
    z.object({
      exerciseId: z.uuid(),
      load: weightSchema,
      reps: z.int().positive(),
    }),
  ),
});
export type Goals = z.infer<typeof goalsSchema>;

export const settingsSchema = z.object({
  ...syncFields,
  weightUnit: z.enum(WEIGHT_UNITS),
  distanceUnit: z.enum(DISTANCE_UNITS),
  /** IANA zone, e.g. `America/New_York`; drives local dates and weekly rollover. */
  timezone: z.string().min(1),
  equipment: equipmentSchema,
  availability: z.array(dayAvailabilitySchema).max(7),
  longRunDay: weekday.nullable(),
  liftFreeDay: weekday.nullable(),
  goals: goalsSchema,
  /** Overrides of engine config keys; the engine validates its own keys. */
  engineConfig: z.record(z.string(), z.unknown()),
});
export type Settings = z.infer<typeof settingsSchema>;

// --- Exercise library -------------------------------------------------------

export const mediaSchema = z.object({
  kind: z.enum(MEDIA_KINDS),
  path: z.string().min(1),
  source: z.string(),
  license: z.string(),
});
export type Media = z.infer<typeof mediaSchema>;

export const exerciseSchema = z.object({
  ...syncFields,
  name: z.string().min(1),
  aliases: z.array(z.string()),
  modality: z.enum(MODALITIES),
  movementPattern: z.string().nullable(),
  primaryMuscles: z.array(z.string()),
  secondaryMuscles: z.array(z.string()),
  equipment: z.array(z.string()),
  mechanic: z.enum(MECHANICS).nullable(),
  unilateral: z.boolean(),
  progressionModel: z.enum(PROGRESSION_MODELS).nullable(),
  increment: weightSchema.nullable(),
  repMin: z.int().positive().nullable(),
  repMax: z.int().positive().nullable(),
  stressTags: z.array(z.enum(STRESS_TAGS)),
  substitutionGroup: z.string().nullable(),
  instructions: z.array(z.string()),
  cues: z.array(z.string()),
  commonMistakes: z.array(z.string()),
  media: z.array(mediaSchema),
  /** Where the entry came from, e.g. `free-exercise-db@<commit>` or `owner`. */
  source: z.string(),
  license: z.string(),
  /** The entry's id in its source dataset, if any. */
  sourceId: z.string().nullable(),
});
export type Exercise = z.infer<typeof exerciseSchema>;

// --- Templates and the global calendar -------------------------------------

export const templateSlotSchema = z
  .object({
    exerciseId: z.uuid().nullable(),
    substitutionGroup: z.string().nullable(),
    sets: z.int().positive(),
    repMin: z.int().positive(),
    repMax: z.int().positive(),
    targetRir: rir.nullable(),
    restSec: count,
    ramp: z.boolean(),
  })
  .refine((s) => s.exerciseId !== null || s.substitutionGroup !== null, {
    message: "A slot needs an exercise or a substitution group",
  });
export type TemplateSlot = z.infer<typeof templateSlotSchema>;

export const templateSchema = z.object({
  ...syncFields,
  name: z.string().min(1),
  modality: z.enum(MODALITIES),
  intensityClass: z.enum(INTENSITY_CLASSES),
  intent: z.enum(INTENTS),
  /** In session order. */
  slots: z.array(templateSlotSchema),
});
export type Template = z.infer<typeof templateSchema>;

export const blockSchema = z.object({
  ...syncFields,
  name: z.string().nullable(),
  startDate: localDate,
  weekCount: z.int().positive(),
  engineVersion: z.string(),
});
export type Block = z.infer<typeof blockSchema>;

export const weekSchema = z.object({
  ...syncFields,
  blockId: z.uuid(),
  /** 0-based position in the block. */
  index: count,
  /** The Monday the week starts on. */
  startDate: localDate,
  type: z.enum(WEEK_TYPES),
  engineVersion: z.string(),
});
export type Week = z.infer<typeof weekSchema>;

export const plannedSessionSchema = z.object({
  ...syncFields,
  weekId: z.uuid().nullable(),
  date: localDate,
  slot: z.enum(DAY_SLOTS),
  modality: z.enum(MODALITIES),
  /** e.g. `push_a`, `easy`, `intervals`, `limit`. */
  workoutType: z.string(),
  templateId: z.uuid().nullable(),
  intent: z.enum(INTENTS),
  status: z.enum(PLANNED_STATUSES),
  /** `manual`, `template`, or `engine@<version>`. */
  generatedBy: z.string(),
});
export type PlannedSession = z.infer<typeof plannedSessionSchema>;

export const plannedItemSchema = z.object({
  ...syncFields,
  plannedSessionId: z.uuid(),
  position: count,
  kind: z.enum(PLANNED_ITEM_KINDS),
  exerciseId: z.uuid().nullable(),
  /** Per-kind targets; typed by the engine interfaces (#45). */
  targets: z.record(z.string(), z.unknown()),
  reasons: z.array(z.string()),
});
export type PlannedItem = z.infer<typeof plannedItemSchema>;

/** A client-owned provisional plan change, replaced when the server regenerates the plan (§3.1). */
export const planOverrideSchema = z.object({
  ...syncFields,
  kind: z.enum(OVERRIDE_KINDS),
  plannedSessionId: z.uuid().nullable(),
  weekId: z.uuid().nullable(),
  data: z.record(z.string(), z.unknown()),
  /** The outbox op that created it. */
  opId: z.uuid(),
  supersededAt: timestamp.nullable(),
});
export type PlanOverride = z.infer<typeof planOverrideSchema>;

// --- Logs -------------------------------------------------------------------

export const sessionLogSchema = z.object({
  ...syncFields,
  plannedSessionId: z.uuid().nullable(),
  modality: z.enum(MODALITIES),
  startedAt: timestamp,
  endedAt: timestamp.nullable(),
  /** Training date and zone where it happened, so history doesn't shift when travelling. */
  localDate,
  timezone: z.string().min(1),
  rpe: rpe.nullable(),
  notes: z.string().nullable(),
});
export type SessionLog = z.infer<typeof sessionLogSchema>;

export const setLogSchema = z.object({
  ...syncFields,
  sessionLogId: z.uuid(),
  exerciseId: z.uuid(),
  /** 0-based set number within the exercise. */
  index: count,
  /** Null for bodyweight or band-only sets. */
  loadValue: z.number().nonnegative().nullable(),
  loadUnit: z.enum(WEIGHT_UNITS).nullable(),
  band: z.string().nullable(),
  reps: count,
  rir: rir.nullable(),
  isWarmup: z.boolean(),
  completedAt: timestamp.nullable(),
});
export type SetLog = z.infer<typeof setLogSchema>;

export const runSplitSchema = z.object({
  distanceValue: z.number().nonnegative(),
  durationSec: count,
});
export type RunSplit = z.infer<typeof runSplitSchema>;

export const runLogSchema = z.object({
  ...syncFields,
  sessionLogId: z.uuid(),
  workoutType: z.string(),
  distanceValue: z.number().nonnegative().nullable(),
  distanceUnit: z.enum(DISTANCE_UNITS),
  durationSec: count.nullable(),
  avgHr: z.int().positive().nullable(),
  elevationValue: z.number().nullable(),
  elevationUnit: z.enum(ELEVATION_UNITS).nullable(),
  rpe: rpe.nullable(),
  /** Split distances are in `distanceUnit`. */
  splits: z.array(runSplitSchema),
});
export type RunLog = z.infer<typeof runLogSchema>;

export const projectSchema = z.object({
  ...syncFields,
  name: z.string().min(1),
  grade: z.string(),
  status: z.enum(PROJECT_STATUSES),
  sentAt: timestamp.nullable(),
  notes: z.string().nullable(),
});
export type Project = z.infer<typeof projectSchema>;

export const ascentSchema = z.object({
  ...syncFields,
  sessionLogId: z.uuid(),
  projectId: z.uuid().nullable(),
  /** e.g. `V4`. */
  grade: z.string().min(1),
  style: z.enum(ASCENT_STYLES),
  attempts: z.int().positive(),
  tags: z.array(z.string()),
});
export type Ascent = z.infer<typeof ascentSchema>;

/** Every synced entity, keyed by the name sync ops use (§3.2). */
export const entitySchemas = {
  settings: settingsSchema,
  exercise: exerciseSchema,
  template: templateSchema,
  block: blockSchema,
  week: weekSchema,
  planned_session: plannedSessionSchema,
  planned_item: plannedItemSchema,
  plan_override: planOverrideSchema,
  session_log: sessionLogSchema,
  set_log: setLogSchema,
  run_log: runLogSchema,
  project: projectSchema,
  ascent: ascentSchema,
} as const;
export type EntityName = keyof typeof entitySchemas;
export const ENTITY_NAMES = Object.keys(entitySchemas) as EntityName[];
export type EntityRow<E extends EntityName> = z.infer<
  (typeof entitySchemas)[E]
>;
