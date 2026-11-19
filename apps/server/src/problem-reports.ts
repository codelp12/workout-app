import type { ProblemReport } from "@workout-app/shared";
import { and, asc, eq, isNull, like } from "drizzle-orm";
import type { Db } from "./db.js";
import { problemReport } from "./schema.js";
import { nextSeq, type Tx } from "./sync.js";

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

export type MarkAllFiledResult =
  { ok: true; reports: ProblemReport[] } | { ok: false; error: string };

/** A report to mark filed: its short id (or full id) and its GitHub issue number. */
export type Filing = { idSuffix: string; issue: number };

class FilingError extends Error {}

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
  const result = markAllFiled(db, [{ idSuffix, issue }], now);
  return result.ok ? { ok: true, report: result.reports[0]! } : result;
}

/**
 * Marks a batch of reports filed in one transaction, so one command clears a whole filing. If any
 * filing is bad, none are marked.
 */
export function markAllFiled(
  db: Db,
  filings: Filing[],
  now = Date.now(),
): MarkAllFiledResult {
  if (filings.length === 0)
    return { ok: false, error: "Give at least one <id> <issue> pair." };
  try {
    const reports = db.transaction((tx) =>
      filings.map((f) => markOne(tx, f, now)),
    );
    return { ok: true, reports };
  } catch (e) {
    if (e instanceof FilingError) return { ok: false, error: e.message };
    throw e;
  }
}

function markOne(tx: Tx, { idSuffix, issue }: Filing, now: number) {
  const fail = (error: string) => new FilingError(error);
  if (idSuffix.length < SHORT_ID_LENGTH || !/^[0-9a-f-]+$/i.test(idSuffix))
    throw fail(
      `${idSuffix || "(empty)"} isn't a report id. Give the report's short id: the ${SHORT_ID_LENGTH} characters after "Report" in the list.`,
    );
  if (!Number.isInteger(issue) || issue < 1)
    throw fail(`The issue number for ${idSuffix} must be a positive integer.`);
  const matches = tx
    .select()
    .from(problemReport)
    .where(like(problemReport.id, `%${idSuffix.toLowerCase()}`))
    .all();
  if (matches.length !== 1)
    throw fail(
      matches.length === 0
        ? `No report id ends with ${idSuffix}.`
        : `More than one report id ends with ${idSuffix}; give more characters.`,
    );
  return tx
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
}
