import { newId, type ProblemReport } from "@workout-app/shared";
import { localDb, pendingCount, save, syncEngine } from "../sync";
import { chipLabel } from "../sync/engine";

let lastScreen: string | null = null;

/** Called on every navigation, so a report knows the screen it's about. */
export function rememberScreen(pathname: string): void {
  if (pathname !== "/settings") lastScreen = pathname;
}

export type ReportDetails = Pick<
  ProblemReport,
  "appBuild" | "screen" | "userAgent" | "syncStatus"
>;

/** What gets attached to a report, shown before sending. */
export async function reportDetails(): Promise<ReportDetails> {
  return {
    appBuild: __APP_BUILD__,
    screen: lastScreen,
    userAgent: navigator.userAgent,
    syncStatus: chipLabel(syncEngine.getState(), await pendingCount()),
  };
}

/** Saves a report locally; it reaches the server with the next sync. */
export async function sendReport(text: string, now = Date.now()) {
  await save("problem_report", {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    text,
    ...(await reportDetails()),
    status: "new",
    githubIssue: null,
  });
}

export const RECENT_REPORTS = 5;

export type ReportState = "waiting" | "sent" | "filed";

export const reportState = (r: ProblemReport): ReportState =>
  r.status === "filed" ? "filed" : r.serverSeq === 0 ? "waiting" : "sent";

/** The newest reports, for the "sent or waiting" list. */
export const recentReports = async () =>
  (await localDb.rows("problem_report").toArray())
    .filter((r) => r.deletedAt === null)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, RECENT_REPORTS);
