import {
  DATA_EXPORT_FORMAT,
  dataExportSchema,
  ENTITY_NAMES,
  type DataExport,
} from "@workout-app/shared";
import { fileStamp } from "../download";
import type { LocalDb } from "../sync/local-db";

/** Every live row on the device, as one JSON file (SPEC §8). */
export async function exportData(
  db: LocalDb,
  now = Date.now(),
): Promise<DataExport> {
  const tables = await Promise.all(
    ENTITY_NAMES.map(async (name) => [
      name,
      (await db.rows(name).toArray())
        .filter((row) => row.deletedAt === null)
        .sort((a, b) => a.id.localeCompare(b.id)),
    ]),
  );
  return {
    format: DATA_EXPORT_FORMAT,
    version: 1,
    exportedAt: now,
    entities: Object.fromEntries(tables) as DataExport["entities"],
  };
}

export const dataFileName = (now = Date.now()) =>
  `workout-app-export-${fileStamp(now)}.json`;

export class DataImportError extends Error {}

/**
 * Writes an export's rows back into `db`, keeping any row the device has
 * that's as new or newer. Nothing is queued for sync: the rows came from the
 * device's copy of the server.
 */
export async function importData(
  db: LocalDb,
  file: unknown,
): Promise<{ written: number; kept: number }> {
  const parsed = dataExportSchema.safeParse(file);
  if (!parsed.success) {
    throw new DataImportError("This isn't a workout-app export file.");
  }
  const { entities } = parsed.data as unknown as DataExport;
  let written = 0;
  let kept = 0;
  await db.transaction("rw", db.tables, async () => {
    for (const name of ENTITY_NAMES) {
      const table = db.rows(name);
      for (const row of entities[name]) {
        const existing = await table.get(row.id);
        if (existing && existing.updatedAt >= row.updatedAt) {
          kept++;
          continue;
        }
        await table.put(row);
        written++;
      }
    }
  });
  return { written, kept };
}
