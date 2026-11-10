import type { EntityName } from "@workout-app/shared";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "./schema.js";

/** The table behind each synced entity, keyed by its sync name. */
export const entityTables = {
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
  problem_report: schema.problemReport,
} satisfies Record<EntityName, SQLiteTable>;
