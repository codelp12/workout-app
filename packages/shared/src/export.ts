import { z } from "zod";
import {
  ENTITY_NAMES,
  entitySchemas,
  type EntityName,
  type EntityRow,
} from "./entities.js";

export const DATA_EXPORT_FORMAT = "workout-app/export";

/** Every synced row on the device, by entity (SPEC §8). */
export type DataExport = {
  format: typeof DATA_EXPORT_FORMAT;
  version: 1;
  exportedAt: number;
  entities: { [E in EntityName]: EntityRow<E>[] };
};

/** Checks the envelope and every row against its entity's schema. */
export const dataExportSchema = z.object({
  format: z.literal(DATA_EXPORT_FORMAT),
  version: z.literal(1),
  exportedAt: z.int().nonnegative(),
  entities: z.object(
    Object.fromEntries(
      ENTITY_NAMES.map((name) => [name, z.array(entitySchemas[name])]),
    ),
  ),
});
