// The Phase 1 acceptance week (SPEC §9), from the server's side:
//   node dist/week-check.js <monday>   e.g. node dist/week-check.js 2026-11-09
// Uses DATABASE_PATH like the server.
import { weekStartOf } from "@workout-app/shared";
import { checkWeek, formatWeekCheck } from "./acceptance.js";
import { databasePath, openDb, runMigrations } from "./db.js";

const [date] = process.argv.slice(2);
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(
    "Usage: node dist/week-check.js <YYYY-MM-DD, any day of the week>",
  );
  process.exit(1);
}
const db = openDb(databasePath);
runMigrations(db);
console.log(formatWeekCheck(checkWeek(db, weekStartOf(date))));
db.$client.close();
