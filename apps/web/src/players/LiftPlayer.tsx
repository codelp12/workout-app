import { toWeightUnit, type WeightImplement } from "@workout-app/engine";
import { newId, type Exercise, type SetLog } from "@workout-app/shared";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { BottomSheet } from "../components/BottomSheet";
import { ChipGroup } from "../components/ChipGroup";
import { ExercisePicker } from "../components/ExercisePicker";
import { LoadPicker } from "../components/LoadPicker";
import { Stepper } from "../components/Stepper";
import { vocabLabel } from "../library/filter";
import { ExerciseImage } from "../library/ExerciseImage";
import { addExercise, skipItem, swapExercise } from "../plan/item-overrides";
import { liftDetail, type SessionView } from "../plan/sessions";
import { readSettings, type SettingsData } from "../settings/settings";
import { localDb, syncSoon } from "../sync";
import { button, buttonBase, card as cardClass } from "../ui";
import { useLiveQuery } from "../use-live-query";
import { DiscardSheet } from "./DiscardSheet";
import { FinishSheet } from "./FinishSheet";
import { HoldTimer } from "./HoldTimer";
import { StretchChecklist } from "./StretchChecklist";
import { WarmupChecklist } from "./WarmupChecklist";
import {
  bandChoices,
  cardDone,
  describeSet,
  discardLift,
  implementOf,
  isBodyweight,
  isTimedHold,
  isWeighted,
  loadChoices,
  loadPosition,
  logSet,
  markActive,
  openRows,
  prefill,
  readLiftSession,
  savePosition,
  takesAddedLoad,
  unitOf,
  warmupCards,
  warmupPlan,
  weightStep,
  type LiftCard,
  type LiftSession,
  type PlayerPosition,
  type SetDraft,
  type SetValues,
} from "./lift-log";
import { holdSeconds, latestRest } from "./rest";
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

function lastTimeLine(
  sets: SetLog[],
  bodyweight: boolean,
  timed: boolean,
): string {
  if (sets.length === 0) return "First time";
  return sets.map((s) => describeSet(s, bodyweight, timed)).join(", ");
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
  library,
  onSwapped,
}: {
  view: SessionView;
  card: LiftCard;
  library: readonly Exercise[];
  onSwapped: () => void;
}) {
  const [open, setOpen] = useState(false);
  async function swap(exerciseId: string) {
    if (exerciseId !== card.exercise?.id) {
      await localDb.transaction(
        "rw",
        localDb.rows("plan_override"),
        localDb.outbox,
        () =>
          Promise.all(
            [card.item, ...(card.duplicateItems ?? [])].map((item) =>
              swapExercise(localDb, item, view.session, exerciseId),
            ),
          ),
      );
    }
    syncSoon();
    setOpen(false);
    onSwapped();
  }
  return (
    <BottomSheet
      title="Swap exercise"
      description="Same movement first, dumbbell and band variants on top. Or search for any exercise."
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={`${button} min-h-tap`}>
          Swap
        </button>
      }
    >
      {card.substitutes.length > 0 && (
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
      )}
      <ExercisePicker
        exercises={library}
        browse={false}
        onPick={(e) => void swap(e.id)}
      />
    </BottomSheet>
  );
}

function AddExerciseSheet({
  view,
  library,
  onAdded,
}: {
  view: SessionView;
  library: readonly Exercise[];
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  async function add(exercise: Exercise) {
    await addExercise(localDb, view.session, exercise);
    syncSoon();
    setOpen(false);
    onAdded();
  }
  return (
    <BottomSheet
      title="Add an exercise"
      description="It goes at the end: 3 sets in its usual rep range, RIR 2."
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={`${button} min-h-tap w-full`}>
          Add exercise
        </button>
      }
    >
      <ExercisePicker exercises={library} onPick={(e) => void add(e)} />
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

/** One set not yet logged: its weight, band, reps and RIR, and its Log button. */
function SetRow({
  card,
  settings,
  number,
  values,
  saving,
  onValues,
  onLog,
  onRemove,
}: {
  card: LiftCard;
  settings: SettingsData;
  /** The set's number on the card, counting the ones logged. */
  number: number;
  values: SetValues;
  saving: boolean;
  onValues: (values: SetValues) => void;
  onLog: () => void;
  /** Missing when this is the card's only set. */
  onRemove?: () => void;
}) {
  const { exercise, targets } = card;
  const timed = isTimedHold(exercise);
  const [holdStartedAt, setHoldStartedAt] = useState<number | null>(null);
  const needsRir = targets.targetRir !== null;
  const unit = unitOf(card, settings);
  const weighted = isWeighted(card);
  const loads = weighted ? loadChoices(card, settings, values.load) : null;
  const bands = bandChoices(card, settings);
  const implement = implementOf(exercise);
  const unloadable = loads !== null && loads.length === 0;
  const label = `Set ${number}`;
  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{label}</h3>
        {onRemove && (
          <button
            type="button"
            className={`${button} min-h-tap`}
            aria-label={`Remove set ${number}`}
            disabled={saving}
            onClick={onRemove}
          >
            Remove
          </button>
        )}
      </div>
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
      {weighted && !loads && values.load !== null && (
        <Stepper
          label="Weight"
          value={values.load}
          step={weightStep(settings)}
          unit={unit}
          onValueChange={(load) => onValues({ ...values, load })}
        />
      )}
      {takesAddedLoad(card) && (
        <Stepper
          label={isBodyweight(exercise) ? "Added weight" : "Weight"}
          value={values.load ?? 0}
          step={weightStep(settings)}
          unit={unit}
          onValueChange={(load) =>
            onValues({ ...values, load: load > 0 ? load : null })
          }
        />
      )}
      {bands && bands.length > 0 && (
        <ChipGroup
          type="single"
          label="Band"
          showLabel
          modality="lift"
          options={bands.map((band) => ({ value: band, label: band }))}
          value={values.band ?? undefined}
          onValueChange={(band) => onValues({ ...values, band })}
        />
      )}
      {bands && bands.length === 0 && values.band && (
        <p className="text-fg-muted">Band: {values.band}</p>
      )}
      {timed && (
        <HoldTimer
          startedAt={holdStartedAt}
          disabled={saving}
          onStart={() => setHoldStartedAt(Date.now())}
          onStop={() => {
            if (holdStartedAt === null) return;
            onValues({
              ...values,
              reps: holdSeconds(holdStartedAt, Date.now()),
            });
            setHoldStartedAt(null);
          }}
        />
      )}
      <Stepper
        label={timed ? "Seconds" : "Reps"}
        value={values.reps}
        onValueChange={(reps) => onValues({ ...values, reps })}
      />
      <ChipGroup
        type="single"
        label="Reps in reserve"
        showLabel
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
          holdStartedAt !== null ||
          (needsRir && values.rir === null)
        }
        onClick={onLog}
      >
        Log set
      </button>
    </section>
  );
}

function ExerciseCard({
  view,
  card,
  settings,
  rows,
  warmups,
  onRows,
  onNext,
  onSkipped,
  library,
  onSwapped,
}: {
  view: SessionView;
  card: LiftCard;
  settings: SettingsData;
  /** The set rows not yet logged. */
  rows: SetDraft[];
  /** Whether the card ramps up with warm-ups. */
  warmups: boolean;
  onRows: (update: (rows: SetDraft[]) => SetDraft[]) => void;
  /** Missing on the last card. */
  onNext?: () => void;
  onSkipped: (skipped: boolean) => void;
  library: readonly Exercise[];
  onSwapped: () => void;
}) {
  const titleId = useId();
  const [saving, setSaving] = useState(false);
  const { exercise, targets, sets, skipped } = card;
  const name = exercise?.name ?? "Pick an exercise";
  const done = sets.length > 0 && rows.length === 0;
  const unit = unitOf(card, settings);
  const bodyweight = isBodyweight(exercise);
  const timed = isTimedHold(exercise);

  async function log(index: number) {
    primeRestCue();
    setSaving(true);
    try {
      await logSet(localDb, view, card, rows[index]!, settings);
      markActive(view.session.id);
      syncSoon();
      onRows((r) => r.filter((_, i) => i !== index));
    } finally {
      setSaving(false);
    }
  }

  async function skip(next: boolean) {
    await localDb.transaction(
      "rw",
      localDb.rows("plan_override"),
      localDb.outbox,
      () =>
        Promise.all(
          [card.item, ...(card.duplicateItems ?? [])].map((item) =>
            skipItem(localDb, item, view.session, next),
          ),
        ),
    );
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
      : (rows[0]?.load ?? null);
  const warmupSets =
    warmups && !skipped ? warmupPlan(card, settings, workingLoad) : [];
  const canSwap = !skipped && sets.length === 0 && card.warmups.length === 0;

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
        <dd>{liftDetail(targets, timed)}</dd>
        <dt className="text-fg-muted">Last time</dt>
        <dd>{lastTimeLine(card.lastTime, bodyweight, timed)}</dd>
      </dl>
      {(canSwap || (!skipped && !done)) && (
        <div className="flex gap-2">
          {canSwap && (
            <SwapSheet
              view={view}
              card={card}
              library={library}
              onSwapped={onSwapped}
            />
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
            <span>{describeSet(set, bodyweight, timed)}</span>
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
      ) : (
        <>
          {rows.map((values, i) => (
            <SetRow
              key={`${exercise?.id}:${values.id}`}
              card={card}
              settings={settings}
              number={sets.length + i + 1}
              values={values}
              saving={saving}
              onValues={(next) =>
                onRows((r) =>
                  r.map((v) =>
                    v.id === values.id ? { ...next, id: v.id } : v,
                  ),
                )
              }
              onLog={() => void log(i)}
              onRemove={
                rows.length > 1 || sets.length > 0
                  ? () => onRows((r) => r.filter((_, j) => j !== i))
                  : undefined
              }
            />
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              className={`${button} min-h-tap`}
              disabled={saving}
              onClick={() => {
                const id = newId();
                onRows((r) => [
                  ...r,
                  { ...(r.at(-1) ?? prefill(card, settings)), id },
                ]);
              }}
            >
              Add set
            </button>
            {done && onNext && (
              <button
                type="button"
                className={`${button} min-h-tap`}
                onClick={onNext}
              >
                Next exercise
              </button>
            )}
          </div>
        </>
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
      <section aria-label="Lift player" className="flex flex-col gap-3">
        <Finished data={data} />
        <StretchChecklist session={view.session} log={data.log} />
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
        <AddExerciseSheet
          view={view}
          library={data.library}
          onAdded={() => setPosition((p) => ({ ...p, card: 0 }))}
        />
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
  const rows = openRows(current, settings, position.drafts[current.itemId]);
  const warmed = warmupCards(cards);
  const allDone = cards.every(
    (c) => c.skipped || cardDone(c, settings, position.drafts[c.itemId]),
  );
  // Sets are logged by exercise, so a session can't hold one exercise twice.
  const inSession = new Set(cards.map((c) => c.exercise?.id));
  const addable = data.library.filter((e) => !inSession.has(e.id));
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
      <WarmupChecklist
        view={view}
        checked={data.log?.checked ?? []}
        startOpen={cards.every((c) => c.sets.length === 0)}
      />
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
        rows={rows}
        warmups={warmed.has(current.itemId)}
        onRows={(update) =>
          setPosition((p) => ({
            ...p,
            drafts: {
              ...p.drafts,
              [current.itemId]: update(p.drafts[current.itemId] ?? rows),
            },
          }))
        }
        onNext={index < cards.length - 1 ? () => go(index + 1) : undefined}
        onSkipped={(skipped) => {
          if (skipped && index < cards.length - 1) go(index + 1);
        }}
        library={addable}
        onSwapped={() => setPosition((p) => ({ ...p, drafts: dropDraft(p) }))}
      />
      <AddExerciseSheet
        view={view}
        library={addable}
        onAdded={() => setPosition((p) => ({ ...p, card: cards.length }))}
      />
      <FinishSheet
        view={view}
        title="Finish workout"
        modality="lift"
        disabled={!data.log}
        prominent={allDone}
      />
      {!data.log && (
        <p className="text-center text-sm text-fg-muted">
          Log a set to finish the workout.
        </p>
      )}
      {data.log && (
        <DiscardSheet
          title="Discard workout"
          onDiscard={async () => {
            await discardLift(localDb, sessionId);
            syncSoon();
            setPosition({ card: 0, drafts: {} });
          }}
        />
      )}
    </section>
  );
}
