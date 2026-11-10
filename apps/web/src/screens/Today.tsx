import type { DaySlot } from "@workout-app/shared";
import { useCallback, useId } from "react";
import { useNavigate } from "react-router";
import { Loading, Skeleton } from "../components/Skeleton";
import { modalityStyles } from "../modality";
import {
  dayPlan,
  formatLongDate,
  sessionSummary,
  type DayPlan,
  type SessionView,
} from "../plan/sessions";
import { useLocalDate } from "../plan/use-local-date";
import { Projects } from "../Projects";
import { readSettings } from "../settings/settings";
import { buttonBase, card } from "../ui";
import { useLiveQuery } from "../use-live-query";
import { Screen } from "./Screen";

const SLOT_LABELS: Record<DaySlot, string> = { am: "AM", pm: "PM" };

function SessionCard({ view }: { view: SessionView }) {
  const navigate = useNavigate();
  const { session, title } = view;
  const style = modalityStyles[session.modality];
  const summary = sessionSummary(view);
  return (
    <li
      className={`${card} ${style.accent} flex items-center gap-3`}
      aria-label={title}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={`text-sm font-medium ${style.text}`}>
          {style.label}
        </span>
        <span className="text-lg font-semibold">{title}</span>
        {summary && (
          <span className="text-fg-muted tabular-nums">{summary}</span>
        )}
      </div>
      {session.status === "planned" ? (
        <button
          type="button"
          className={`${buttonBase} min-h-tap ${style.fill}`}
          aria-label={`Start ${title}`}
          onClick={() => void navigate(`/session/${session.id}`)}
        >
          Start
        </button>
      ) : (
        <span className="font-medium text-fg-muted">
          {session.status === "done" ? "Done" : "Skipped"}
        </span>
      )}
    </li>
  );
}

function Slot({ slot, sessions }: { slot: DaySlot; sessions: SessionView[] }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-sm font-semibold text-fg-muted">
        {SLOT_LABELS[slot]}
      </h2>
      {sessions.length === 0 ? (
        <p className={`${card} text-fg-muted`}>Nothing planned.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sessions.map((view) => (
            <SessionCard key={view.session.id} view={view} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CoachNote() {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`${card} flex flex-col gap-1`}>
      <h2 id={id} className="font-semibold">
        Coach note
      </h2>
      <p className="text-fg-muted">
        A note on today&apos;s plan will show here once the coaching engines
        arrive.
      </p>
    </section>
  );
}

function Plan({ date }: { date: string }) {
  const query = useCallback(() => dayPlan(date), [date]);
  const plan = useLiveQuery<DayPlan | undefined>(query, undefined);
  if (!plan) {
    return (
      <Loading label="Loading today's sessions">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </Loading>
    );
  }
  return (
    <>
      <p className="-mt-2 flex items-center gap-2 text-fg-muted">
        {formatLongDate(date)}
        {plan.week?.type === "deload" && (
          <span className="rounded-full bg-surface-raised px-2 text-sm font-medium text-fg">
            Deload week
          </span>
        )}
      </p>
      {plan.slots.am.length + plan.slots.pm.length === 0 ? (
        <p className={`${card} text-fg-muted`}>
          Rest day: nothing planned today.
        </p>
      ) : (
        (["am", "pm"] as const).map((slot) => (
          <Slot key={slot} slot={slot} sessions={plan.slots[slot]} />
        ))
      )}
    </>
  );
}

export function Today() {
  const settings = useLiveQuery(readSettings, null);
  const date = useLocalDate(settings?.timezone ?? null);
  return (
    <Screen title="Today">
      {date ? (
        <Plan date={date} />
      ) : (
        <Loading label="Loading today's sessions">
          <Skeleton className="h-20 w-full" />
        </Loading>
      )}
      <CoachNote />
      <Projects />
    </Screen>
  );
}
