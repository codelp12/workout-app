import {
  formatAmount,
  toWeightUnit,
  type WeightImplement,
} from "@workout-app/engine";
import type { SetLog } from "@workout-app/shared";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { BottomSheet } from "../components/BottomSheet";
import { ChipGroup } from "../components/ChipGroup";
import { LoadPicker } from "../components/LoadPicker";
import { Stepper } from "../components/Stepper";
import { vocabLabel } from "../library/filter";
import { ExerciseImage } from "../library/ExerciseImage";
import { skipItem, swapExercise } from "../plan/item-overrides";
import { liftDetail, type SessionView } from "../plan/sessions";
import { readSettings, type SettingsData } from "../settings/settings";
import { localDb, syncSoon } from "../sync";
import { button, buttonBase, card as cardClass, input } from "../ui";
import { useLiveQuery } from "../use-live-query";
import {
  bandChoices,
  finishSession,
  implementOf,
  isWeighted,
  loadChoices,
  loadPosition,
  logSet,
  markActive,
  prefill,
  readLiftSession,
  savePosition,
  settle,
  unitOf,
  warmupCards,
  warmupPlan,
  weightStep,
  type LiftCard,
  type LiftSession,
  type PlayerPosition,
  type SetValues,
} from "./lift-log";
import { latestRest } from "./rest";
import { primeRestCue } from "./rest-cue";
import { RestTimer } from "./RestTimer";
import { useWakeLock } from "./use-wake-lock";

const IMPLEMENT_NAMES: Record<WeightImplement, string> = {
  dumbbell: "dumbbells",
  barbell: "barbells",
  bar: "barbells",
  stack: "cable or machine stack",
};

const RIR_OPTIONS = ["0", "1", "2", "3", "4"].map((value) => ({
  value,
  label: value,
}));

// A horizontal drag this far (px) flips to the next or previous card.
const SWIPE = 60;

function describeSet(
  set: Pick<SetLog, "loadValue" | "loadUnit" | "band" | "reps" | "rir">,
) {
  const what =
    set.loadValue !== null && set.loadUnit
      ? formatAmount(set.loadValue, set.loadUnit)
      : (set.band ?? "Bodyweight");
  return `${what} × ${set.reps}${set.rir === null ? "" : ` · RIR ${set.rir}`}`;
}

function lastTimeLine(sets: SetLog[]): string {
  if (sets.length === 0) return "First time";
  return sets.map(describeSet).join(", ");
}

const RPE_OPTIONS = Array.from({ length: 10 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

function FinishSheet({ view }: { view: SessionView }) {
  const notesId = useId();
  const [open, setOpen] = useState(false);
  const [rpe, setRpe] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  async function finish() {
    if (rpe === null) return;
    setSaving(true);
    try {
      await finishSession(localDb, view, { rpe, notes });
      syncSoon();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }
  return (
    <BottomSheet
      title="Finish workout"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={`${button} min-h-tap w-full`}>
          Finish workout
        </button>
      }
    >
      <ChipGroup
        type="single"
        label="Session RPE"
        modality="lift"
        options={RPE_OPTIONS}
        value={rpe === null ? undefined : String(rpe)}
        onValueChange={(value) => setRpe(Number(value))}
      />
      <label htmlFor={notesId} className="font-medium">
        Notes
      </label>
      <textarea
        id={notesId}
        rows={3}
        className={`${input} py-2`}
        placeholder="How it went, anything to remember…"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <button
        type="button"
        className={`${buttonBase} min-h-tap bg-lift text-bg`}
        disabled={saving || rpe === null}
        onClick={() => void finish()}
      >
        Finish
      </button>
    </BottomSheet>
  );
}

function Finished({ data }: { data: LiftSession }) {
  const log = data.log!;
  const sets = data.cards.reduce((sum, c) => sum + c.sets.length, 0);
  const minutes = Math.max(
    1,
    Math.round((log.endedAt! - log.startedAt) / 60_000),
  );
  return (
    <section
      aria-label="Workout finished"
      className={`${cardClass} flex flex-col gap-2`}
    >
      <h2 className="text-xl font-semibold text-lift">Workout finished</h2>
      <p className="tabular-nums">
        {sets} working set{sets === 1 ? "" : "s"} · {minutes} min
        {log.rpe === null ? "" : ` · RPE ${log.rpe}`}
      </p>
      {log.notes && <p className="whitespace-pre-wrap">{log.notes}</p>}
      <Link to="/" className={`${button} min-h-tap self-start`}>
        Back to Today
      </Link>
    </section>
  );
}

function SwapSheet({
  view,
  card,
  onSwapped,
}: {
  view: SessionView;
  card: LiftCard;
  onSwapped: () => void;
}) {
  const [open, setOpen] = useState(false);
  async function swap(exerciseId: string) {
    await swapExercise(localDb, card.item, view.session, exerciseId);
    syncSoon();
    setOpen(false);
    onSwapped();
  }
  return (
    <BottomSheet
      title="Swap exercise"
      description="Same movement, other equipment. Dumbbell and band variants first."
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={`${button} min-h-tap`}>
          Swap
        </button>
      }
    >
      <ul aria-label="Substitutes" className="flex flex-col gap-2">
        {card.substitutes.map((e) => {
          const current = e.id === card.exercise?.id;
          return (
            <li key={e.id}>
              <button
                type="button"
                aria-pressed={current}
                className={`${button} min-h-tap w-full flex-col items-start text-left ${current ? "ring-2 ring-lift" : ""}`}
                onClick={() => void swap(e.id)}
              >
                <span className="font-medium">{e.name}</span>
                <span className="text-sm text-fg-muted">
                  {e.equipment.map(vocabLabel).join(", ") || "No equipment"}
                  {e.id === card.item.exerciseId ? " · Planned" : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}

function Warmups({
  view,
  card,
  settings,
  plan,
}: {
  view: SessionView;
  card: LiftCard;
  settings: SettingsData;
  plan: SetValues[];
}) {
  const [saving, setSaving] = useState(false);
  const unit = unitOf(card, settings);
  const logged = card.warmups.length;
  async function log(values: SetValues) {
    setSaving(true);
    try {
      await logSet(localDb, view, card, values, settings, Date.now(), true);
      markActive(view.session.id);
      syncSoon();
    } finally {
      setSaving(false);
    }
  }
  return (
    <details className="rounded-lg bg-surface-raised px-3 py-2">
      <summary className="min-h-tap cursor-pointer content-center font-medium">
        Warm-up · {Math.min(logged, plan.length)} of {plan.length}
      </summary>
      <ol
        aria-label="Warm-up sets"
        className="flex flex-col gap-1 tabular-nums"
      >
        {plan.map((values, i) => {
          const set = card.warmups[i];
          const what = describeSet(
            set ?? {
              loadValue: values.load,
              loadUnit: unit,
              band: values.band,
              reps: values.reps,
              rir: null,
            },
          );
          return (
            <li
              key={i}
              className="flex min-h-tap items-center justify-between gap-2"
            >
              <span>
                <span className="text-fg-muted">Warm-up {i + 1}</span> {what}
              </span>
              {set ? (
                <span className="text-lift">Done</span>
              ) : (
                <button
                  type="button"
                  className={`${button} min-h-tap`}
                  aria-label={`Log warm-up ${i + 1}`}
                  disabled={saving || i !== logged}
                  onClick={() => void log(values)}
                >
                  Log
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function ExerciseCard({
  view,
  card,
  settings,
  values,
  planned,
  warmups,
  onValues,
  onLogged,
  onAddSet,
  onSkipped,
  onSwapped,
}: {
  view: SessionView;
  card: LiftCard;
  settings: SettingsData;
  values: SetValues;
  /** The planned sets plus any added. */
  planned: number;
  /** Whether the card ramps up with warm-ups. */
  warmups: boolean;
  onValues: (values: SetValues) => void;
  onLogged: (done: boolean) => void;
  onAddSet: () => void;
  onSkipped: (skipped: boolean) => void;
  onSwapped: () => void;
}) {
  const titleId = useId();
  const [saving, setSaving] = useState(false);
  const { exercise, targets, sets, skipped } = card;
  const name = exercise?.name ?? "Pick an exercise";
  const done = sets.length >= planned;
  const needsRir = targets.targetRir !== null;
  const unit = unitOf(card, settings);
  const weighted = isWeighted(card);
  const loads = weighted ? loadChoices(card, settings, values.load) : null;
  const bands = bandChoices(card, settings);
  const implement = implementOf(exercise);
  const unloadable = loads !== null && loads.length === 0;

  async function log() {
    primeRestCue();
    setSaving(true);
    try {
      await logSet(localDb, view, card, values, settings);
      markActive(view.session.id);
      syncSoon();
      onLogged(sets.length + 1 >= planned);
    } finally {
      setSaving(false);
    }
  }

  async function skip(next: boolean) {
    await skipItem(localDb, card.item, view.session, next);
    syncSoon();
    onSkipped(next);
  }

  const first = sets[0];
  const workingLoad =
    first?.loadValue != null
      ? toWeightUnit(
          { value: first.loadValue, unit: first.loadUnit ?? unit },
          unit,
        )
      : values.load;
  const warmupSets =
    warmups && !skipped ? warmupPlan(card, settings, workingLoad) : [];
  const canSwap =
    !skipped &&
    sets.length === 0 &&
    card.warmups.length === 0 &&
    card.substitutes.length > 1;

  return (
    <article
      aria-labelledby={titleId}
      className={`${cardClass} flex flex-col gap-3`}
    >
      {exercise?.media[0] && (
        <ExerciseImage
          path={exercise.media[0].path}
          alt={name}
          className="aspect-video w-full"
        />
      )}
      <div className="flex items-start justify-between gap-2">
        <h2 id={titleId} className="text-xl font-semibold">
          {name}
        </h2>
        {exercise && (
          <Link
            to={`/library/${exercise.id}`}
            className={`${button} min-h-tap`}
          >
            How to
          </Link>
        )}
      </div>
      {exercise && exercise.cues.length > 0 && (
        <ul aria-label="Cues" className="flex flex-wrap gap-2">
          {exercise.cues.map((cue) => (
            <li
              key={cue}
              className="rounded-full bg-surface-raised px-3 py-1 text-sm"
            >
              {cue}
            </li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 tabular-nums">
        <dt className="text-fg-muted">Target</dt>
        <dd>{liftDetail(targets)}</dd>
        <dt className="text-fg-muted">Last time</dt>
        <dd>{lastTimeLine(card.lastTime)}</dd>
      </dl>
      {(canSwap || (!skipped && !done)) && (
        <div className="flex gap-2">
          {canSwap && (
            <SwapSheet view={view} card={card} onSwapped={onSwapped} />
          )}
          {!done && (
            <button
              type="button"
              className={`${button} min-h-tap`}
              onClick={() => void skip(true)}
            >
              Skip
            </button>
          )}
        </div>
      )}
      {warmupSets.length > 0 && (
        <Warmups
          view={view}
          card={card}
          settings={settings}
          plan={warmupSets}
        />
      )}
      <ol aria-label="Sets" className="flex flex-col gap-1 tabular-nums">
        {sets.map((set) => (
          <li key={set.id} className="flex justify-between">
            <span className="text-fg-muted">Set {set.index + 1}</span>
            <span>{describeSet(set)}</span>
          </li>
        ))}
      </ol>
      {skipped ? (
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-fg-muted">Skipped.</p>
          <button
            type="button"
            className={`${button} min-h-tap`}
            onClick={() => void skip(false)}
          >
            Undo skip
          </button>
        </div>
      ) : done ? (
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-lift">All {planned} sets done.</p>
          <button
            type="button"
            className={`${button} min-h-tap`}
            onClick={onAddSet}
          >
            Add set
          </button>
        </div>
      ) : (
        <section
          aria-label={`Set ${sets.length + 1} of ${planned}`}
          className="flex flex-col gap-3"
        >
          <h3 className="font-semibold">
            Set {sets.length + 1} of {planned}
          </h3>
          {loads && values.load !== null && loads.length > 0 && (
            <LoadPicker
              label="Weight"
              value={values.load}
              options={loads}
              unit={unit}
              onValueChange={(load) => onValues({ ...values, load })}
            />
          )}
          {unloadable && implement && (
            <p className="text-fg-muted">
              No {IMPLEMENT_NAMES[implement]} in your equipment.{" "}
              <Link to="/settings" className="text-accent underline">
                Add them in Settings
              </Link>{" "}
              to log this set.
            </p>
          )}
          {!loads && values.load !== null && (
            <Stepper
              label="Weight"
              value={values.load}
              step={weightStep(settings)}
              unit={unit}
              onValueChange={(load) => onValues({ ...values, load })}
            />
          )}
          {bands && bands.length > 0 && (
            <ChipGroup
              type="single"
              label="Band"
              modality="lift"
              options={bands.map((band) => ({ value: band, label: band }))}
              value={values.band ?? undefined}
              onValueChange={(band) => onValues({ ...values, band })}
            />
          )}
          {bands && bands.length === 0 && values.band && (
            <p className="text-fg-muted">Band: {values.band}</p>
          )}
          <Stepper
            label="Reps"
            value={values.reps}
            onValueChange={(reps) => onValues({ ...values, reps })}
          />
          <ChipGroup
            type="single"
            label="Reps in reserve"
            modality="lift"
            options={RIR_OPTIONS}
            value={values.rir === null ? undefined : String(values.rir)}
            onValueChange={(rir) => onValues({ ...values, rir: Number(rir) })}
          />
          <button
            type="button"
            className={`${buttonBase} min-h-tap bg-lift text-bg`}
            disabled={
              saving ||
              !exercise ||
              unloadable ||
              (needsRir && values.rir === null)
            }
            onClick={() => void log()}
          >
            Log set
          </button>
        </section>
      )}
    </article>
  );
}

/**
 * The lift player (SPEC §6.3): one card per exercise, swiped or stepped
 * through. Each set is saved as it's logged, and the card on screen and any
 * unlogged values survive the app being killed. The screen stays on until the
 * session is finished or the player is left.
 */
export function LiftPlayer({ view }: { view: SessionView }) {
  const sessionId = view.session.id;
  const settings = useLiveQuery(readSettings, null);
  const query = useCallback(() => readLiftSession(localDb, view), [view]);
  const data = useLiveQuery<LiftSession | undefined>(query, undefined);
  const [position, setPosition] = useState<PlayerPosition>(() =>
    loadPosition(sessionId),
  );
  const swipeStart = useRef<number | null>(null);

  useEffect(() => savePosition(sessionId, position), [sessionId, position]);
  useWakeLock(data !== undefined && data.log?.endedAt == null);

  if (!data || !settings) return <section aria-label="Lift player" />;
  if (data.log?.endedAt != null) {
    return (
      <section aria-label="Lift player">
        <Finished data={data} />
      </section>
    );
  }
  const { cards } = data;
  if (cards.length === 0) {
    return (
      <section aria-label="Lift player">
        <p className={`${cardClass} text-fg-muted`}>
          Nothing is planned for this session yet.
        </p>
      </section>
    );
  }

  const index = Math.min(Math.max(position.card, 0), cards.length - 1);
  const current = cards[index]!;
  const rest = latestRest(cards);
  const go = (card: number) =>
    setPosition((p) => ({
      ...p,
      card: Math.min(Math.max(card, 0), cards.length - 1),
    }));
  const draft = position.drafts[current.itemId];
  const values = draft
    ? settle(current, settings, draft)
    : prefill(current, settings);
  const extra = position.extra?.[current.itemId] ?? 0;
  const warmed = warmupCards(cards);
  const dropDraft = (p: PlayerPosition) => {
    const drafts = { ...p.drafts };
    delete drafts[current.itemId];
    return drafts;
  };

  return (
    <section
      aria-label="Lift player"
      className="flex touch-pan-y flex-col gap-3"
      onPointerDown={(e) => {
        swipeStart.current = e.clientX;
      }}
      onPointerUp={(e) => {
        const start = swipeStart.current;
        swipeStart.current = null;
        if (start === null) return;
        const dx = e.clientX - start;
        if (dx <= -SWIPE) go(index + 1);
        else if (dx >= SWIPE) go(index - 1);
      }}
    >
      <nav
        aria-label="Exercises"
        className="flex items-center justify-between gap-2"
      >
        <button
          type="button"
          className={`${button} min-h-tap`}
          disabled={index === 0}
          onClick={() => go(index - 1)}
        >
          Previous
        </button>
        <span className="text-fg-muted tabular-nums">
          Exercise {index + 1} of {cards.length}
        </span>
        <button
          type="button"
          className={`${button} min-h-tap`}
          disabled={index === cards.length - 1}
          onClick={() => go(index + 1)}
        >
          Next
        </button>
      </nav>
      {rest && <RestTimer rest={rest} />}
      <ExerciseCard
        key={current.itemId}
        view={view}
        card={current}
        settings={settings}
        values={values}
        planned={current.targets.sets + extra}
        warmups={warmed.has(current.itemId)}
        onValues={(next) =>
          setPosition((p) => ({
            ...p,
            drafts: { ...p.drafts, [current.itemId]: next },
          }))
        }
        onLogged={(done) =>
          setPosition((p) => {
            const card = done && index < cards.length - 1 ? index + 1 : p.card;
            return { ...p, card, drafts: dropDraft(p) };
          })
        }
        onAddSet={() =>
          setPosition((p) => ({
            ...p,
            extra: { ...p.extra, [current.itemId]: extra + 1 },
          }))
        }
        onSkipped={(skipped) => {
          if (skipped && index < cards.length - 1) go(index + 1);
        }}
        onSwapped={() => setPosition((p) => ({ ...p, drafts: dropDraft(p) }))}
      />
      {data.log && <FinishSheet view={view} />}
    </section>
  );
}
