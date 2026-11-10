import {
  addDays,
  DAY_SLOTS,
  weekStartOf,
  type DaySlot,
  type Modality,
} from "@workout-app/shared";
import { useCallback, useId, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { BottomSheet } from "../components/BottomSheet";
import { ChipGroup } from "../components/ChipGroup";
import { Loading, Skeleton } from "../components/Skeleton";
import { modalityStyles } from "../modality";
import { moveSession, samePlacement, type Placement } from "../plan/moves";
import {
  formatLongDate,
  formatShortDay,
  formatWeekRange,
  sessionSummary,
  weekPlan,
  type SessionView,
  type WeekPlan,
  type WeekTally,
} from "../plan/sessions";
import { useLocalDate } from "../plan/use-local-date";
import { readSettings } from "../settings/settings";
import { localDb, syncSoon } from "../sync";
import { button, buttonBase, card } from "../ui";
import { useLiveQuery } from "../use-live-query";
import { Screen } from "./Screen";

const SLOT_LABELS: Record<DaySlot, string> = { am: "AM", pm: "PM" };
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

const statusLabel = (view: SessionView) =>
  view.session.status === "done"
    ? "Done"
    : view.session.status === "skipped"
      ? "Skipped"
      : null;

const isMoved = (view: SessionView) =>
  !samePlacement(view.session, view.planned);

function SessionButton({
  view,
  onSelect,
}: {
  view: SessionView;
  onSelect: (view: SessionView) => void;
}) {
  const style = modalityStyles[view.session.modality];
  const status = statusLabel(view);
  const label = [
    view.title,
    SLOT_LABELS[view.session.slot],
    status,
    isMoved(view) && "moved",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <button
      type="button"
      aria-label={label}
      className={`${style.accent} flex min-h-tap w-full min-w-0 flex-col rounded-lg bg-surface px-2 py-1 text-left active:bg-surface-raised`}
      onClick={() => onSelect(view)}
    >
      <span className="flex items-center gap-1">
        <span className="truncate font-medium">{view.title}</span>
        {isMoved(view) && (
          <span className="text-xs text-fg-muted" aria-hidden="true">
            moved
          </span>
        )}
      </span>
      <span className="truncate text-xs text-fg-muted tabular-nums">
        {status ?? sessionSummary(view)}
      </span>
    </button>
  );
}

function Day({
  day,
  today,
  filter,
  onSelect,
}: {
  day: WeekPlan["days"][number];
  today: string;
  filter: Filter;
  onSelect: (view: SessionView) => void;
}) {
  const isToday = day.date === today;
  return (
    <li
      aria-label={formatLongDate(day.date)}
      aria-current={isToday ? "date" : undefined}
      className={`grid grid-cols-[3rem_1fr_1fr] items-start gap-2 rounded-xl p-2 ${isToday ? "bg-surface-raised" : ""}`}
    >
      <span className="flex flex-col pt-1 leading-tight" aria-hidden="true">
        <span className="font-semibold">{formatShortDay(day.date)}</span>
        {isToday && <span className="text-xs text-accent">Today</span>}
      </span>
      {DAY_SLOTS.map((slot) => {
        const views = day.slots[slot].filter(
          (v) => filter === "all" || v.session.modality === filter,
        );
        return (
          <div key={slot} className="flex min-w-0 flex-col gap-1">
            {views.length === 0 ? (
              <span className="min-h-tap px-2 py-1 text-fg-muted">
                <span aria-hidden="true">–</span>
                <span className="sr-only">
                  {SLOT_LABELS[slot]}: nothing planned
                </span>
              </span>
            ) : (
              views.map((v) => (
                <SessionButton
                  key={v.session.id}
                  view={v}
                  onSelect={onSelect}
                />
              ))
            )}
          </div>
        );
      })}
    </li>
  );
}

function Tally({
  tally,
  filter,
}: {
  tally: WeekPlan["tally"];
  filter: Filter;
}) {
  const id = useId();
  const cell = (t: WeekTally[Modality]) =>
    t.planned === 0 && t.done === 0 ? "–" : `${t.done} of ${t.planned}`;
  return (
    <section aria-labelledby={id} className={`${card} flex flex-col gap-2`}>
      <h2 id={id} className="font-semibold">
        Last week vs this week
      </h2>
      <table className="w-full text-left tabular-nums">
        <caption className="sr-only">Sessions done of planned</caption>
        <thead className="text-sm text-fg-muted">
          <tr>
            <th scope="col" className="font-normal">
              <span className="sr-only">Modality</span>
            </th>
            <th scope="col" className="font-normal">
              Last week
            </th>
            <th scope="col" className="font-normal">
              This week
            </th>
          </tr>
        </thead>
        <tbody>
          {SHOWN.filter((m) => filter === "all" || m === filter).map((m) => (
            <tr key={m}>
              <th
                scope="row"
                className={`font-medium ${modalityStyles[m].text}`}
              >
                {modalityStyles[m].label}
              </th>
              <td>{cell(tally.last[m])}</td>
              <td>{cell(tally.current[m])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-fg-muted">Sessions done of planned.</p>
    </section>
  );
}

function MoveForm({
  view,
  weekStart,
  onDone,
}: {
  view: SessionView;
  weekStart: string;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const [to, setTo] = useState<Placement>({
    date: view.session.date,
    slot: view.session.slot,
  });
  const [saving, setSaving] = useState(false);
  const movable = view.session.status === "planned";
  const style = modalityStyles[view.session.modality];
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const move = async (placement: Placement) => {
    setSaving(true);
    try {
      await moveSession(localDb, view.session, view.planned, placement);
      syncSoon();
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <p className="flex flex-wrap gap-x-2 text-fg-muted">
        <span className={`font-medium ${style.text}`}>{style.label}</span>
        <span className="tabular-nums">{sessionSummary(view)}</span>
      </p>
      {isMoved(view) && (
        <p className="text-fg-muted">
          Planned for {formatLongDate(view.planned.date)},{" "}
          {SLOT_LABELS[view.planned.slot]}.
        </p>
      )}
      {movable ? (
        <>
          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">Day</h3>
            <ChipGroup
              type="single"
              label="Day"
              modality={view.session.modality}
              options={days.map((date) => ({
                value: date,
                label: formatShortDay(date),
              }))}
              value={to.date}
              onValueChange={(date) => setTo({ ...to, date })}
            />
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">Time</h3>
            <ChipGroup
              type="single"
              label="Time"
              modality={view.session.modality}
              options={DAY_SLOTS.map((slot) => ({
                value: slot,
                label: SLOT_LABELS[slot],
              }))}
              value={to.slot}
              onValueChange={(slot) => setTo({ ...to, slot })}
            />
          </section>
          <button
            type="button"
            className={`${buttonBase} min-h-tap ${style.fill}`}
            disabled={saving || samePlacement(to, view.session)}
            onClick={() => void move(to)}
          >
            Move
          </button>
          {isMoved(view) && (
            <button
              type="button"
              className={`${button} min-h-tap`}
              disabled={saving}
              onClick={() => void move(view.planned)}
            >
              Put back
            </button>
          )}
        </>
      ) : (
        <p className="text-fg-muted">
          {statusLabel(view)} sessions stay where they are.
        </p>
      )}
      <button
        type="button"
        className={`${button} min-h-tap`}
        onClick={() => void navigate(`/session/${view.session.id}`)}
      >
        Open session
      </button>
    </>
  );
}

function Plan({ weekStart, today }: { weekStart: string; today: string }) {
  const [params, setParams] = useSearchParams();
  const filter = readFilter(params);
  const query = useCallback(() => weekPlan(weekStart), [weekStart]);
  const plan = useLiveQuery<WeekPlan | undefined>(query, undefined);
  const [selected, setSelected] = useState<SessionView | null>(null);

  if (!plan) {
    return (
      <Loading label="Loading this week">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </Loading>
    );
  }
  const empty = plan.days.every(
    (d) => d.slots.am.length + d.slots.pm.length === 0,
  );
  return (
    <>
      <p className="-mt-2 flex items-center gap-2 text-fg-muted">
        {formatWeekRange(weekStart)}
        {plan.week?.type === "deload" && (
          <span className="rounded-full bg-surface-raised px-2 text-sm font-medium text-fg">
            Deload week
          </span>
        )}
      </p>
      <ChipGroup
        type="single"
        label="Show"
        options={FILTERS}
        value={filter}
        onValueChange={(next) =>
          setParams(next === "all" ? {} : { show: next }, { replace: true })
        }
      />
      <Tally tally={plan.tally} filter={filter} />
      {empty ? (
        <p className={`${card} text-fg-muted`}>
          Nothing planned this week yet.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <div
            aria-hidden="true"
            className="grid grid-cols-[3rem_1fr_1fr] gap-2 px-2 text-sm font-semibold text-fg-muted"
          >
            <span />
            <span>AM</span>
            <span>PM</span>
          </div>
          <ol aria-label="Days" className="flex flex-col gap-1">
            {plan.days.map((day) => (
              <Day
                key={day.date}
                day={day}
                today={today}
                filter={filter}
                onSelect={setSelected}
              />
            ))}
          </ol>
        </div>
      )}
      <BottomSheet
        title={selected?.title ?? ""}
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        {selected && (
          <MoveForm
            key={selected.session.id}
            view={selected}
            weekStart={weekStart}
            onDone={() => setSelected(null)}
          />
        )}
      </BottomSheet>
    </>
  );
}

export function Week() {
  const settings = useLiveQuery(readSettings, null);
  const today = useLocalDate(settings?.timezone ?? null);
  return (
    <Screen title="Week">
      {today ? (
        <Plan weekStart={weekStartOf(today)} today={today} />
      ) : (
        <Loading label="Loading this week">
          <Skeleton className="h-64 w-full" />
        </Loading>
      )}
    </Screen>
  );
}
