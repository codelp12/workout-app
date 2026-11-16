import { weekStartOf, type Modality } from "@workout-app/shared";
import { useCallback, useId } from "react";
import { Link, useSearchParams } from "react-router";
import { ChipGroup } from "../components/ChipGroup";
import { Loading, Skeleton } from "../components/Skeleton";
import { readHistory, type HistoryEntry } from "../history/history";
import { modalityStyles } from "../modality";
import { formatShortDay, formatWeekRange } from "../plan/sessions";
import { localDb } from "../sync";
import { card } from "../ui";
import { useLiveQuery } from "../use-live-query";
import { Screen } from "./Screen";

const SHOWN = ["lift", "run", "climb"] as const satisfies Modality[];
type Filter = (typeof SHOWN)[number] | "all";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  ...SHOWN.map((m) => ({ value: m, label: modalityStyles[m].label })),
];

function readFilter(params: URLSearchParams): Filter {
  const show = params.get("show");
  return SHOWN.find((m) => m === show) ?? "all";
}

function EntryRow({ entry }: { entry: HistoryEntry }) {
  const { log, title, summary } = entry;
  const style = modalityStyles[log.modality];
  return (
    <li>
      <Link
        to={`/log/${log.id}`}
        className={`${card} ${style.accent} flex flex-col active:bg-surface-raised`}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className={`text-sm font-medium ${style.text}`}>
            {style.label}
          </span>
          <span className="text-sm text-fg-muted">
            {formatShortDay(log.localDate)}
          </span>
        </span>
        <span className="flex items-baseline gap-2">
          <span className="text-lg font-semibold">{title}</span>
          {log.endedAt === null && (
            <span className="rounded-full bg-surface-raised px-2 text-sm font-medium text-fg">
              Not finished
            </span>
          )}
        </span>
        {summary && (
          <span className="text-fg-muted tabular-nums">{summary}</span>
        )}
      </Link>
    </li>
  );
}

function WeekGroup({
  weekStart,
  entries,
}: {
  weekStart: string;
  entries: HistoryEntry[];
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-sm font-semibold text-fg-muted">
        {formatWeekRange(weekStart)}
      </h2>
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <EntryRow key={entry.log.id} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

/** Groups entries, already newest first, by the week they fall in. */
function byWeek(entries: HistoryEntry[]): [string, HistoryEntry[]][] {
  const weeks = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const start = weekStartOf(entry.log.localDate);
    weeks.set(start, [...(weeks.get(start) ?? []), entry]);
  }
  return [...weeks];
}

/** Past sessions of every modality, week by week, newest first (§6.7). */
export function Log() {
  const [params, setParams] = useSearchParams();
  const filter = readFilter(params);
  const query = useCallback(() => readHistory(localDb), []);
  const history = useLiveQuery<HistoryEntry[] | undefined>(query, undefined);
  const shown = history?.filter(
    (e) => filter === "all" || e.log.modality === filter,
  );
  return (
    <Screen title="Log">
      <ChipGroup
        type="single"
        label="Show"
        options={FILTERS}
        value={filter}
        onValueChange={(next) =>
          setParams(next === "all" ? {} : { show: next }, { replace: true })
        }
      />
      {!shown ? (
        <Loading label="Loading your history">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </Loading>
      ) : shown.length === 0 ? (
        <p className={`${card} text-fg-muted`}>
          {filter === "all"
            ? "No sessions logged yet. Sessions you log show up here."
            : `No ${modalityStyles[filter].label.toLowerCase()} sessions logged yet.`}
        </p>
      ) : (
        byWeek(shown).map(([weekStart, entries]) => (
          <WeekGroup key={weekStart} weekStart={weekStart} entries={entries} />
        ))
      )}
    </Screen>
  );
}
