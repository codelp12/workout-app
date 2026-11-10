// Problem reports from Settings → Report a problem:
//   node dist/reports.js                           lists new reports as Markdown
//   node dist/reports.js mark-filed <id> <issue>   marks one filed as GitHub issue <issue>
// Uses DATABASE_PATH like the server.
import { databasePath, openDb, runMigrations } from "./db.js";
import { formatReports, markFiled, newReports } from "./problem-reports.js";

const USAGE = `Usage:
  node dist/reports.js                           list new reports
  node dist/reports.js mark-filed <id> <issue>   mark a report filed as GitHub issue <issue>`;

const [command, id, issue] = process.argv.slice(2);
const db = openDb(databasePath);
runMigrations(db);
let exitCode = 0;
if (command === undefined) {
  console.log(formatReports(newReports(db)));
} else if (command === "mark-filed" && id && issue) {
  const result = markFiled(db, id, Number(issue.replace(/^#/, "")));
  if (result.ok)
    console.log(`Marked ${id} as filed as #${result.report.githubIssue}.`);
  else {
    console.error(result.error);
    exitCode = 1;
  }
} else {
  console.error(USAGE);
  exitCode = 1;
}
db.$client.close();
process.exit(exitCode);
