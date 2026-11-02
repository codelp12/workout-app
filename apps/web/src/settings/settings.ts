import {
  defaultSettings,
  SETTINGS_ID,
  type UpsertData,
} from "@workout-app/shared";
import { localDb, save } from "../sync";

export type SettingsData = UpsertData<"settings">;

/** This device's time zone, e.g. `America/New_York`. */
export const deviceTimezone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The saved settings, or the defaults until something is saved. Stable, so
 * it can go straight into `useLiveQuery`.
 */
export async function readSettings(): Promise<SettingsData> {
  const row = await localDb.rows("settings").get(SETTINGS_ID);
  if (!row || row.deletedAt !== null) {
    return defaultSettings(deviceTimezone(), Date.now());
  }
  // `save` sets `userId` and `serverSeq` itself, so the extra keys are harmless.
  return row;
}

let queue: Promise<void> = Promise.resolve();

/**
 * Applies `change` to the latest saved settings and saves them through the
 * outbox. Updates run one at a time, so quick taps don't overwrite each other.
 */
export function updateSettings(
  change: (current: SettingsData) => Partial<SettingsData>,
): Promise<void> {
  const run = queue.then(async () => {
    const current = await readSettings();
    await save("settings", {
      ...current,
      ...change(current),
      id: SETTINGS_ID,
      updatedAt: Date.now(),
    });
  });
  queue = run.catch(() => {});
  return run;
}
