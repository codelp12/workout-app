import type { ProblemReport } from "@workout-app/shared";
import { and, asc, eq, isNull, like } from "drizzle-orm";
import type { Db } from "./db.js";
import { problemReport } from "./schema.js";
import { nextSeq } from "./sync.js";

/** Characters of the id shown in listings and accepted by `markFiled`. */
export const SHORT_ID_LENGTH = 8;

// The end of the id: UUIDv7s start with a timestamp, so their starts collide.
export const shortId = (id: string) => id.slice(-SHORT_ID_LENGTH);

/** Reports not yet filed as GitHub issues, oldest first. */
export function newReports(db: Db): ProblemReport[] {
  return db
    .select()
    .from(problemReport)
    .where(
      and(eq(problemReport.status, "new"), isNull(problemReport.deletedAt)),
    )
    .orderBy(asc(problemReport.createdAt))
    .all();
}

/** Markdown for a list of reports, ready to paste into an issue or a Devin session. */
export function formatReports(reports: ProblemReport[]): string {
  if (reports.length === 0) return "No new problem reports.";
  return reports
    .map((r) =>
      [
        `## Report ${shortId(r.id)}`,
        "",
        r.text,
        "",
        `- Reported: ${new Date(r.createdAt).toISOString()}`,
        `- Screen: ${r.screen ?? "unknown"}`,
        `- App build: ${r.appBuild}`,
        `- Sync status: ${r.syncStatus}`,
        `- Device: ${r.userAgent}`,
      ].join("\n"),
    )
    .join("\n\n");
}

export type MarkFiledResult =
  { ok: true; report: ProblemReport } | { ok: false; error: string };

/**
 * Marks the report whose id ends with `idSuffix` (its short id, or the full id) as filed as GitHub issue
 * `issue`. It takes a new `serverSeq`, so the phone pulls the change.
 */
export function markFiled(
  db: Db,
  idSuffix: string,
  issue: number,
  now = Date.now(),
): MarkFiledResult {
  if (idSuffix.length < SHORT_ID_LENGTH || !/^[0-9a-f-]+$/i.test(idSuffix))
    return {
      ok: false,
      error: `Give the report's short id: the ${SHORT_ID_LENGTH} characters after "Report" in the list.`,
    };
  if (!Number.isInteger(issue) || issue < 1)
    return { ok: false, error: "The issue number must be a positive integer." };
  return db.transaction((tx) => {
    const matches = tx
      .select()
      .from(problemReport)
      .where(like(problemReport.id, `%${idSuffix.toLowerCase()}`))
      .all();
    if (matches.length !== 1)
      return {
        ok: false,
        error:
          matches.length === 0
            ? `No report id ends with ${idSuffix}.`
            : `More than one report id ends with ${idSuffix}; give more characters.`,
      };
    const report = tx
      .update(problemReport)
      .set({
        status: "filed",
        githubIssue: issue,
        updatedAt: now,
        serverSeq: nextSeq(tx),
      })
      .where(eq(problemReport.id, matches[0]!.id))
      .returning()
      .get();
    return { ok: true, report };
  });
}
