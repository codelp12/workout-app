import { RUN_WORKOUT_TYPES, formatAmount } from "@workout-app/engine";
import type { DistanceUnit, RunSplit } from "@workout-app/shared";
import { useCallback, useId, useState } from "react";
import { Link } from "react-router";
import { ChipGroup } from "../components/ChipGroup";
import {
  formatRange,
  sessionTitle,
  type RunTargets,
  type SessionView,
} from "../plan/sessions";
import { readSettings } from "../settings/settings";
import { localDb, syncSoon } from "../sync";
import { button, buttonBase, card, input } from "../ui";
import { useLiveQuery } from "../use-live-query";
import {
  durationOf,
  elevationUnitFor,
  formatDuration,
  formatPace,
  logRun,
  paceSec,
  parseNumber,
  readRunSession,
  type RunSession,
} from "./run-log";

const RPE_OPTIONS = Array.from({ length: 10 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

const workoutName = (workoutType: string) =>
  sessionTitle({ workoutType }, null);

const TYPE_OPTIONS = RUN_WORKOUT_TYPES.map((type) => ({
  value: type,
  label: workoutName(type).replace(/ run$/, ""),
}));

/** The planned run as bars, sized by distance (§6.4). */
function WorkoutBars({ view }: { view: SessionView }) {
  const runs = view.items.map((item) => ({
    id: item.id,
    run: item.targets as RunTargets,
  }));
  const longest = Math.max(0, ...runs.map((r) => r.run.distance?.value ?? 0));
  if (runs.length === 0) {
    return (
      <p className={`${card} text-fg-muted`}>
        Nothing is planned for this run yet.
      </p>
    );
  }
  return (
    <ol aria-label="Planned workout" className={`${card} flex flex-col gap-2`}>
      {runs.map(({ id, run }) => {
        const share =
          run.distance && longest > 0 ? run.distance.value / longest : 1;
        const label = [
          run.distance
            ? formatAmount(run.distance.value, run.distance.unit)
            : "By feel",
          `RPE ${formatRange(run.targetRpe)}`,
        ].join(" · ");
        return (
          <li key={id} className="flex flex-col gap-1">
            <span className="tabular-nums">{label}</span>
            <span
              aria-hidden="true"
              className="block h-3 rounded-full bg-run"
              style={{ width: `${Math.max(10, share * 100)}%` }}
            />
          </li>
        );
      })}
    </ol>
  );
}

function NumberField({
  label,
  value,
  onChange,
  decimal = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  decimal?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode={decimal ? "decimal" : "numeric"}
        className={`${input} min-h-tap tabular-nums`}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

type SplitDraft = { distance: string; minutes: string; seconds: string };

const toSplit = (s: SplitDraft): RunSplit | null => {
  const distance = parseNumber(s.distance);
  const durationSec = durationOf(s.minutes, s.seconds);
  return distance && distance > 0 && durationSec
    ? { distanceValue: distance, durationSec }
    : null;
};

function PaceLine({
  distance,
  durationSec,
  unit,
}: {
  distance: number | null;
  durationSec: number | null;
  unit: DistanceUnit;
}) {
  const pace = paceSec(distance, durationSec);
  return (
    <p className="tabular-nums text-fg-muted" aria-live="polite">
      Pace {pace === null ? "–" : formatPace(pace, unit)}
    </p>
  );
}

function RunForm({ view, unit }: { view: SessionView; unit: DistanceUnit }) {
  const planned = (view.items[0]?.targets as RunTargets | undefined)?.distance;
  const [workoutType, setWorkoutType] = useState(view.session.workoutType);
  const [distance, setDistance] = useState(
    planned && planned.unit === unit ? String(planned.value) : "",
  );
  const [minutes, setMinutes] = useState("");
  const [seconds, setSeconds] = useState("");
  const [avgHr, setAvgHr] = useState("");
  const [elevation, setElevation] = useState("");
  const [rpe, setRpe] = useState<number | null>(null);
  const [splits, setSplits] = useState<SplitDraft[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const notesId = useId();

  const distanceValue = parseNumber(distance);
  const durationSec = durationOf(minutes, seconds);
  const hr = parseNumber(avgHr);
  const ready =
    distanceValue !== null &&
    distanceValue > 0 &&
    durationSec !== null &&
    rpe !== null &&
    (avgHr.trim() === "" || (hr !== null && hr > 0)) &&
    (elevation.trim() === "" || parseNumber(elevation) !== null);

  async function save() {
    if (!ready) return;
    setSaving(true);
    try {
      const settings = await readSettings();
      await logRun(
        localDb,
        view,
        {
          workoutType,
          distance: distanceValue,
          durationSec,
          avgHr: hr === null ? null : Math.round(hr),
          elevation: parseNumber(elevation),
          rpe,
          splits: splits.map(toSplit).filter((s) => s !== null),
          notes,
        },
        { distanceUnit: unit, timezone: settings.timezone },
      );
      syncSoon();
    } finally {
      setSaving(false);
    }
  }

  const updateSplit = (i: number, patch: Partial<SplitDraft>) =>
    setSplits((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <form
      aria-label="Log run"
      className={`${card} flex flex-col gap-3`}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <ChipGroup
        type="single"
        label="Workout type"
        modality="run"
        options={TYPE_OPTIONS}
        value={workoutType}
        onValueChange={setWorkoutType}
      />
      <NumberField
        label={`Distance (${unit})`}
        value={distance}
        onChange={setDistance}
        decimal
      />
      <div className="flex gap-2">
        <NumberField label="Minutes" value={minutes} onChange={setMinutes} />
        <NumberField label="Seconds" value={seconds} onChange={setSeconds} />
      </div>
      <PaceLine
        distance={distanceValue}
        durationSec={durationSec}
        unit={unit}
      />
      <ChipGroup
        type="single"
        label="RPE"
        modality="run"
        options={RPE_OPTIONS}
        value={rpe === null ? undefined : String(rpe)}
        onValueChange={(value) => setRpe(Number(value))}
      />
      <details className="flex flex-col gap-3">
        <summary className="min-h-tap py-3 font-medium">
          Heart rate, elevation and splits
        </summary>
        <div className="flex gap-2">
          <NumberField
            label="Avg heart rate"
            value={avgHr}
            onChange={setAvgHr}
            placeholder="bpm"
          />
          <NumberField
            label={`Elevation gain (${elevationUnitFor(unit)})`}
            value={elevation}
            onChange={setElevation}
            decimal
          />
        </div>
        <ol aria-label="Splits" className="flex flex-col gap-3 pt-3">
          {splits.map((split, i) => {
            const done = toSplit(split);
            return (
              <li key={i} className="flex flex-col gap-1">
                <span className="font-medium">Split {i + 1}</span>
                <div className="flex gap-2">
                  <NumberField
                    label={`Split ${i + 1} distance (${unit})`}
                    value={split.distance}
                    onChange={(distance) => updateSplit(i, { distance })}
                    decimal
                  />
                  <NumberField
                    label={`Split ${i + 1} minutes`}
                    value={split.minutes}
                    onChange={(minutes) => updateSplit(i, { minutes })}
                  />
                  <NumberField
                    label={`Split ${i + 1} seconds`}
                    value={split.seconds}
                    onChange={(seconds) => updateSplit(i, { seconds })}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <PaceLine
                    distance={done?.distanceValue ?? null}
                    durationSec={done?.durationSec ?? null}
                    unit={unit}
                  />
                  <button
                    type="button"
                    className={`${button} min-h-tap`}
                    onClick={() =>
                      setSplits((all) => all.filter((_, j) => j !== i))
                    }
                  >
                    Remove split {i + 1}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          className={`${button} mt-3 min-h-tap self-start`}
          onClick={() =>
            setSplits((all) => [
              ...all,
              { distance: "1", minutes: "", seconds: "" },
            ])
          }
        >
          Add split
        </button>
      </details>
      <label htmlFor={notesId} className="font-medium">
        Notes
      </label>
      <textarea
        id={notesId}
        rows={2}
        className={`${input} py-2`}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <button
        type="submit"
        className={`${buttonBase} min-h-tap bg-run text-bg`}
        disabled={saving || !ready}
      >
        Save run
      </button>
    </form>
  );
}

function RunSummary({ session }: { session: Required<RunSession> }) {
  const run = session.run!;
  const log = session.log!;
  const unit = run.distanceUnit;
  const pace = paceSec(run.distanceValue, run.durationSec);
  const facts = [
    workoutName(run.workoutType),
    run.distanceValue !== null && formatAmount(run.distanceValue, unit),
    run.durationSec !== null && formatDuration(run.durationSec),
    pace !== null && formatPace(pace, unit),
    run.rpe !== null && `RPE ${run.rpe}`,
  ].filter(Boolean);
  const extras = [
    run.avgHr !== null && `${run.avgHr} bpm`,
    run.elevationValue !== null &&
      `${run.elevationValue} ${run.elevationUnit ?? ""} gain`.replace(
        "  ",
        " ",
      ),
  ].filter(Boolean);
  return (
    <section aria-label="Run logged" className={`${card} flex flex-col gap-2`}>
      <h2 className="text-xl font-semibold text-run">Run logged</h2>
      <p className="tabular-nums">{facts.join(" · ")}</p>
      {extras.length > 0 && (
        <p className="tabular-nums text-fg-muted">{extras.join(" · ")}</p>
      )}
      {run.splits.length > 0 && (
        <ol aria-label="Splits" className="flex flex-col tabular-nums">
          {run.splits.map((split, i) => (
            <li key={i}>
              {i + 1}. {formatAmount(split.distanceValue, unit)} in{" "}
              {formatDuration(split.durationSec)} (
              {formatPace(split.durationSec / split.distanceValue, unit)})
            </li>
          ))}
        </ol>
      )}
      {log.notes && <p className="whitespace-pre-wrap">{log.notes}</p>}
      <Link to="/" className={`${button} min-h-tap self-start`}>
        Back to Today
      </Link>
    </section>
  );
}

/** Manual run logging against the planned run (§6.4). */
export function RunPlayer({ view }: { view: SessionView }) {
  const sessionId = view.session.id;
  const query = useCallback(
    () => readRunSession(localDb, sessionId),
    [sessionId],
  );
  const data = useLiveQuery<RunSession | undefined>(query, undefined);
  const settings = useLiveQuery(readSettings, null);
  if (!data || !settings) return <section aria-label="Run player" />;
  return (
    <section aria-label="Run player" className="flex flex-col gap-3">
      <WorkoutBars view={view} />
      {data.run && data.log?.endedAt != null ? (
        <RunSummary session={data} />
      ) : (
        <RunForm view={view} unit={settings.distanceUnit} />
      )}
    </section>
  );
}
