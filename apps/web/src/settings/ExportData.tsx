import { useState } from "react";
import { download, fileStamp } from "../download";
import { climbsCsv, runsCsv, setsCsv } from "../export/csv";
import { dataFileName, exportData } from "../export/export";
import type { LocalDb } from "../sync/local-db";
import { localDb } from "../sync";
import { button } from "../ui";
import { Section } from "./Sections";

const csv = (kind: string, read: (db: LocalDb) => Promise<string>) => ({
  label: `${kind[0]!.toUpperCase()}${kind.slice(1)} (CSV)`,
  run: async (now: number) =>
    download(
      `workout-app-${kind}-${fileStamp(now)}.csv`,
      await read(localDb),
      "text/csv",
    ),
});

const EXPORTS = [
  {
    label: "Everything (JSON)",
    run: async (now: number) =>
      download(
        dataFileName(now),
        JSON.stringify(await exportData(localDb, now), null, 2),
        "application/json",
      ),
  },
  csv("sets", setsCsv),
  csv("runs", runsCsv),
  csv("climbs", climbsCsv),
];

/** Downloads this device's data as JSON or CSV (SPEC §8). Works offline. */
export function ExportData() {
  const [failed, setFailed] = useState(false);
  return (
    <Section title="Export">
      <p className="text-sm text-fg-muted">
        Everything on this device, as one JSON file or as spreadsheets of your
        sets, runs and climbs.
      </p>
      <div className="flex flex-wrap gap-2">
        {EXPORTS.map(({ label, run }) => (
          <button
            key={label}
            type="button"
            className={`${button} min-h-tap`}
            onClick={() => {
              setFailed(false);
              run(Date.now()).catch((error: unknown) => {
                console.error("Export failed", error);
                setFailed(true);
              });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {failed && (
        <p role="status" className="text-sm text-danger">
          Export failed.
        </p>
      )}
    </Section>
  );
}
