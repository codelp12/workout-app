// Problem reports from Settings → Report a problem:
//   node dist/reports.js                           lists new reports as Markdown
//   node dist/reports.js mark-filed <id> <issue> [<id> <issue> ...]
//                                                  marks reports filed as GitHub issues, all or none
// Uses DATABASE_PATH like the server.
import { databasePath, openDb, runMigrations } from "./db.js";
import {
  formatReports,
  markAllFiled,
  newReports,
  type Filing,
} from "./problem-reports.js";

const USAGE = `Usage:
  node dist/reports.js                           list new reports
  node dist/reports.js mark-filed <id> <issue> [<id> <issue> ...]
                                                 mark reports filed as GitHub issues`;

const [command, ...args] = process.argv.slice(2);
const db = openDb(databasePath);
runMigrations(db);
let exitCode = 0;
if (command === undefined) {
  console.log(formatReports(newReports(db)));
} else if (
  command === "mark-filed" &&
  args.length > 0 &&
  args.length % 2 === 0
) {
  const filings: Filing[] = [];
  for (let i = 0; i < args.length; i += 2)
    filings.push({
      idSuffix: args[i]!,
      issue: Number(args[i + 1]!.replace(/^#/, "")),
    });
  const result = markAllFiled(db, filings);
  if (result.ok)
    for (const [i, report] of result.reports.entries())
      console.log(
        `Marked ${filings[i]!.idSuffix} as filed as #${report.githubIssue}.`,
      );
  else {
    console.error(
      filings.length > 1 ? `${result.error} Nothing was marked.` : result.error,
    );
    exitCode = 1;
  }
} else {
  console.error(USAGE);
  exitCode = 1;
}
db.$client.close();
process.exit(exitCode);
