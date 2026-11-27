import {
  addDays,
  DAY_SLOTS,
  weekStartOf,
  type DaySlot,
  type Modality,
} from "@workout-app/shared";
import { formatAmount, type LiftReview } from "@workout-app/engine";
import { useCallback, useId, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { BottomSheet } from "../components/BottomSheet";
import { ChipGroup } from "../components/ChipGroup";
import { Loading, Skeleton } from "../components/Skeleton";
import { vocabLabel } from "../library/filter";
import { modalityStyles } from "../modality";
import {
  readWeeklyLiftReview,
  type WeeklyLiftReview,
} from "../plan/lift-review";
import { moveSession, samePlacement, type Placement } from "../plan/moves";
import {
  formatLongDate,
  formatShortDay,
  formatWeekRange,
  liftDetail,
  sessionSummary,
  weekPlan,
  type LiftTargets,
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
  view.inProgress
    ? "In progress"
    : view.session.status === "done"
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
    view.combineCandidate && "can combine",
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
      {view.combineCandidate && (
        <span className="truncate text-xs text-fg-muted">Can combine</span>
      )}
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

function LastWeekLiftReview({ weekStart }: { weekStart: string }) {
  const id = useId();
  const query = useCallback(() => readWeeklyLiftReview(weekStart), [weekStart]);
  const review = useLiveQuery<WeeklyLiftReview | undefined>(query, undefined);
  const e1rmSummary = (exercise: LiftReview["exercises"][number]) => {
    if (exercise.e1rmAfter === null) return "e1RM —";
    const change = exercise.e1rmChange
      ? ` (${exercise.e1rmChange.value >= 0 ? "+" : "-"}${formatAmount(
          Math.abs(exercise.e1rmChange.value),
          exercise.e1rmChange.unit,
        )})`
      : "";
    return `e1RM ${formatAmount(exercise.e1rmAfter.value, exercise.e1rmAfter.unit)}${change}`;
  };
  return (
    <section aria-labelledby={id} className={`${card} flex flex-col gap-3`}>
      <h2 id={id} className="font-semibold">
        Last week's lifting
      </h2>
      {review ? (
        <>
          {review.exercises.length === 0 ? (
            <p className="text-fg-muted">No lifting logged last week.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {review.exercises.map((exercise) => {
                const timed = review.timedExerciseIds.includes(
                  exercise.exerciseId,
                );
                return (
                  <li
                    key={exercise.exerciseId}
                    className="flex flex-col gap-1 border-b border-border pb-3 last:border-0 last:pb-0"
                  >
                    <h3 className="font-medium">{exercise.name}</h3>
                    <p className="text-sm">
                      Top set{" "}
                      {exercise.topSet.load
                        ? formatAmount(
                            exercise.topSet.load.value,
                            exercise.topSet.load.unit,
                          )
                        : (exercise.topSet.band ?? "Bodyweight")}{" "}
                      × {exercise.topSet.reps}
                      {timed ? " s" : ""} · {exercise.workingSets} sets ·{" "}
                      {exercise.totalReps}
                      {timed ? " s total" : " reps"}
                    </p>
                    <p className="text-sm">{e1rmSummary(exercise)}</p>
                    {exercise.thisWeek ? (
                      <>
                        <p className="text-sm">
                          This week:{" "}
                          {liftDetail(
                            exercise.thisWeek.targets as LiftTargets,
                            timed,
                          )}
                        </p>
                        {exercise.thisWeek.reasons.length > 0 && (
                          <ul className="list-disc pl-5 text-sm text-fg-muted">
                            {exercise.thisWeek.reasons.map((reason, index) => (
                              <li key={`${index}:${reason}`}>{reason}</li>
                            ))}
                          </ul>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-fg-muted">
                        Not planned this week
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">Hard sets per muscle</h3>
            {review.muscles.length > 0 ? (
              <ul className="flex flex-col gap-1 text-sm">
                {review.muscles.map(({ muscle, hardSets, cap }) => (
                  <li
                    key={muscle}
                    className="flex flex-wrap items-baseline justify-between gap-x-3"
                  >
                    <span>{vocabLabel(muscle)}</span>
                    <span className="tabular-nums">
                      {hardSets} / {cap}
                      {hardSets > cap && (
                        <span className="ml-2 font-medium">Over cap</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">No hard sets to count.</p>
            )}
          </div>
        </>
      ) : (
        <Skeleton className="h-24 w-full" />
      )}
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
        {view.inProgress ? "Resume session" : "Open session"}
      </button>
    </>
  );
}

function Plan({ weekStart, today }: { weekStart: string; today: string }) {
  const [params, setParams] = useSearchParams();
  const filter = readFilter(params);
  const query = useCallback(() => weekPlan(weekStart), [weekStart]);
  const plan = useLiveQuery<WeekPlan | undefined>(query, undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
  const selected = plan.days
    .flatMap((day) => [...day.slots.am, ...day.slots.pm])
    .find((view) => view.session.id === selectedId);
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
                onSelect={(view) => setSelectedId(view.session.id)}
              />
            ))}
          </ol>
        </div>
      )}
      <LastWeekLiftReview weekStart={weekStart} />
      <BottomSheet
        title={selected?.title ?? ""}
        open={selected !== undefined}
        onOpenChange={(open) => !open && setSelectedId(null)}
      >
        {selected && (
          <MoveForm
            key={selected.session.id}
            view={selected}
            weekStart={weekStart}
            onDone={() => setSelectedId(null)}
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
