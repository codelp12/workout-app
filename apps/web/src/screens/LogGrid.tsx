import { formatAmount } from "@workout-app/engine";
import { addDays } from "@workout-app/shared";
import { useCallback, useId } from "react";
import { useSearchParams } from "react-router";
import { Loading, Skeleton } from "../components/Skeleton";
import {
  gridSpan,
  readGrid,
  type ClimbWeek,
  type GridWeek,
  type LiftCell,
  type LiftRow,
  type LogGrid as Grid,
  type RunWeek,
} from "../history/grid";
import { describeSet } from "../players/lift-log";
import { formatDuration } from "../players/run-log";
import { formatDateRange, formatRange } from "../plan/sessions";
import { useLocalDate } from "../plan/use-local-date";
import { readSettings, type SettingsData } from "../settings/settings";
import { localDb } from "../sync";
import { button, card, input } from "../ui";
import { useLiveQuery } from "../use-live-query";

type Shown = "all" | "lift" | "run" | "climb";

const formatShortDate = (date: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));

const table = "w-full border-collapse text-left tabular-nums";
const th = "px-2 py-1 align-bottom text-sm font-medium text-fg-muted";
const td = "px-2 py-2 align-top";
const sticky = "sticky left-0 z-10 bg-surface";

function WeekHead({ week }: { week: GridWeek }) {
  return (
    <th scope="col" className={`${th} min-w-24`}>
      <span className="block text-fg">Week {week.number}</span>
      <span className="block">{formatShortDate(week.start)}</span>
      {week.type && week.type !== "loading" && (
        <span className="block capitalize text-warning">{week.type}</span>
      )}
    </th>
  );
}

function targetText({ target }: LiftCell): string | null {
  if (!target) return null;
  const reps = formatRange({ min: target.repMin, max: target.repMax });
  const what = target.load
    ? formatAmount(target.load.value, target.load.unit)
    : target.band;
  return [`${target.sets} × ${reps}`, what].filter(Boolean).join(" · ");
}

function LiftCellView({ cell }: { cell: LiftCell }) {
  const target = targetText(cell);
  if (!cell.top && !target) return <span className="text-fg-muted">–</span>;
  return (
    <>
      <span className="block whitespace-nowrap">
        {cell.top ? describeSet({ ...cell.top, rir: null }) : "Not logged"}
      </span>
      {target && (
        <span className="block whitespace-nowrap text-sm text-fg-muted">
          Target {target}
        </span>
      )}
    </>
  );
}

function LiftGrid({ weeks, rows }: { weeks: GridWeek[]; rows: LiftRow[] }) {
  const [params, setParams] = useSearchParams();
  const selectId = useId();
  const chosen = params.get("exercise");
  const shown = rows.filter((r) => !chosen || r.exerciseId === chosen);
  return (
    <section aria-label="Lifting" className={`${card} flex flex-col gap-3`}>
      <h2 className="font-semibold">Lifting</h2>
      <label htmlFor={selectId} className="flex flex-col gap-1 text-sm">
        <span className="text-fg-muted">Exercise</span>
        <select
          id={selectId}
          className={`${input} min-h-tap`}
          value={chosen ?? ""}
          onChange={(e) => {
            const next = new URLSearchParams(params);
            if (e.target.value) next.set("exercise", e.target.value);
            else next.delete("exercise");
            setParams(next, { replace: true });
          }}
        >
          <option value="">All exercises</option>
          {rows.map((r) => (
            <option key={r.exerciseId} value={r.exerciseId}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {shown.length === 0 ? (
        <p className="text-fg-muted">No lifting planned or logged.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className={table} aria-label="Lifting by week">
            <thead>
              <tr>
                <th scope="col" className={`${th} ${sticky}`}>
                  Exercise
                </th>
                {weeks.map((w) => (
                  <WeekHead key={w.start} week={w} />
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.exerciseId} className="border-t border-border">
                  <th
                    scope="row"
                    className={`${td} ${sticky} min-w-32 font-medium`}
                  >
                    {row.name}
                  </th>
                  {row.cells.map((cell, i) => (
                    <td key={weeks[i]!.start} className={td}>
                      <LiftCellView cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function WeeklyTable<T>({
  title,
  weeks,
  rows,
  columns,
}: {
  title: string;
  weeks: GridWeek[];
  rows: T[];
  columns: { label: string; value: (row: T) => string }[];
}) {
  return (
    <section aria-label={title} className={`${card} flex flex-col gap-3`}>
      <h2 className="font-semibold">{title}</h2>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className={table} aria-label={`${title} by week`}>
          <thead>
            <tr>
              <th scope="col" className={`${th} ${sticky}`}>
                Week
              </th>
              {columns.map((c) => (
                <th key={c.label} scope="col" className={th}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const week = weeks[i]!;
              return (
                <tr key={week.start} className="border-t border-border">
                  <th scope="row" className={`${td} ${sticky} font-medium`}>
                    <span className="block whitespace-nowrap">
                      Week {week.number}
                    </span>
                    {week.type && week.type !== "loading" && (
                      <span className="block text-sm capitalize text-warning">
                        {week.type}
                      </span>
                    )}
                  </th>
                  {columns.map((c) => (
                    <td key={c.label} className={`${td} whitespace-nowrap`}>
                      {c.value(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const amount = (value: number, unit: string) =>
  value === 0 ? "–" : formatAmount(Math.round(value * 10) / 10, unit);

function runColumns(unit: string) {
  return [
    { label: "Runs", value: (w: RunWeek) => `${w.runs} of ${w.planned}` },
    {
      label: "Distance",
      value: (w: RunWeek) =>
        w.plannedDistance > 0
          ? `${amount(w.distance, unit)} of ${amount(w.plannedDistance, unit)}`
          : amount(w.distance, unit),
    },
    { label: "Longest", value: (w: RunWeek) => amount(w.longest, unit) },
    {
      label: "Time",
      value: (w: RunWeek) =>
        w.durationSec > 0 ? formatDuration(w.durationSec) : "–",
    },
  ];
}

const climbColumns = [
  {
    label: "Sessions",
    value: (w: ClimbWeek) => `${w.sessions} of ${w.planned}`,
  },
  { label: "Sends", value: (w: ClimbWeek) => `${w.sends}` },
  { label: "Attempts", value: (w: ClimbWeek) => `${w.attempts}` },
  {
    label: "Hardest",
    value: (w: ClimbWeek) => w.hardest.join(" · ") || "–",
  },
];

type Loaded = {
  span: Awaited<ReturnType<typeof gridSpan>>;
  grid: Grid;
};

function Grids({
  settings,
  today,
  shown,
}: {
  settings: SettingsData;
  today: string;
  shown: Shown;
}) {
  const [params, setParams] = useSearchParams();
  const blockStart = params.get("block");
  const { weightUnit, distanceUnit } = settings;
  const query = useCallback(async (): Promise<Loaded> => {
    const span = await gridSpan(localDb, today, blockStart);
    const grid = await readGrid(
      localDb,
      span.weeks.map((w) => w.start),
      { weightUnit, distanceUnit },
    );
    return { span, grid };
  }, [today, blockStart, weightUnit, distanceUnit]);
  const loaded = useLiveQuery<Loaded | undefined>(query, undefined);
  if (!loaded) {
    return (
      <Loading label="Loading the log grid">
        <Skeleton className="h-40 w-full" />
      </Loading>
    );
  }
  const { span, grid } = loaded;
  const first = span.weeks[0]!.start;
  const last = addDays(span.weeks[span.weeks.length - 1]!.start, 6);
  const page = (block: string | null) => {
    const next = new URLSearchParams(params);
    if (block) next.set("block", block);
    next.delete("exercise");
    setParams(next, { replace: true });
  };
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className={button}
          disabled={!span.earlier}
          onClick={() => page(span.earlier)}
        >
          Earlier block
        </button>
        <h2 className="text-center text-sm font-semibold text-fg-muted">
          {formatDateRange(first, last)}
        </h2>
        <button
          type="button"
          className={button}
          disabled={!span.later}
          onClick={() => page(span.later)}
        >
          Later block
        </button>
      </div>
      {(shown === "all" || shown === "lift") && (
        <LiftGrid weeks={span.weeks} rows={grid.lift} />
      )}
      {(shown === "all" || shown === "run") && (
        <WeeklyTable
          title="Running"
          weeks={span.weeks}
          rows={grid.run}
          columns={runColumns(distanceUnit)}
        />
      )}
      {(shown === "all" || shown === "climb") && (
        <WeeklyTable
          title="Climbing"
          weeks={span.weeks}
          rows={grid.climb}
          columns={climbColumns}
        />
      )}
    </>
  );
}

/** The spreadsheet view: one block of lifting, running and climbing (§6.7). */
export function LogGrid({ shown }: { shown: Shown }) {
  const settings = useLiveQuery(readSettings, null);
  const today = useLocalDate(settings?.timezone ?? null);
  if (!settings || !today) {
    return (
      <Loading label="Loading the log grid">
        <Skeleton className="h-40 w-full" />
      </Loading>
    );
  }
  return <Grids settings={settings} today={today} shown={shown} />;
}
