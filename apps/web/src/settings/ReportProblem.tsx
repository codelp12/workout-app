import { PROBLEM_REPORT_MAX_LENGTH } from "@workout-app/shared";
import { useEffect, useId, useState, type FormEvent } from "react";
import { useToast } from "../components/toast-context";
import { button, input } from "../ui";
import { useLiveQuery } from "../use-live-query";
import {
  recentReports,
  reportDetails,
  reportState,
  sendReport,
  type ReportDetails,
} from "./problem-report";
import { Section } from "./Sections";

const stateLabels = {
  waiting: () => "Waiting to send",
  sent: () => "Sent",
  filed: (issue: number | null) => `Filed as #${issue}`,
};

/** A beta "Report a problem" box; reports queue offline like any other write. */
export function ReportProblem() {
  const toast = useToast();
  const id = useId();
  const [draft, setDraft] = useState("");
  const [details, setDetails] = useState<ReportDetails | null>(null);
  const reports = useLiveQuery(recentReports, []);

  useEffect(() => {
    void reportDetails().then(setDetails);
  }, [reports]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    await sendReport(text);
    setDraft("");
    toast({
      title: "Report saved",
      description: "It sends with the next sync.",
    });
  }

  return (
    <Section title="Report a problem">
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => void onSubmit(event)}
      >
        <label htmlFor={id} className="text-sm text-fg-muted">
          What went wrong? Include what you tapped and what you expected.
        </label>
        <textarea
          id={id}
          rows={4}
          maxLength={PROBLEM_REPORT_MAX_LENGTH}
          className={`${input} py-2`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        {details && (
          <dl
            aria-label="Sent with the report"
            className="grid grid-cols-[auto_1fr] gap-x-3 text-xs text-fg-muted"
          >
            <dt>Screen</dt>
            <dd className="break-all">{details.screen ?? "Unknown"}</dd>
            <dt>Build</dt>
            <dd>{details.appBuild}</dd>
            <dt>Sync</dt>
            <dd>{details.syncStatus}</dd>
            <dt>Device</dt>
            <dd className="break-all">{details.userAgent}</dd>
          </dl>
        )}
        <button
          type="submit"
          className={`${button} min-h-tap self-start`}
          disabled={!draft.trim()}
        >
          Send report
        </button>
      </form>
      {reports.length > 0 && (
        <ul aria-label="Your reports" className="flex flex-col gap-2">
          {reports.map((r) => (
            <li key={r.id} className="flex justify-between gap-3 text-sm">
              <span className="truncate">{r.text}</span>
              <span className="shrink-0 text-fg-muted">
                {stateLabels[reportState(r)](r.githubIssue)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
