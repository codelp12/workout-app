import { formatAmount, type WeightImplement } from "@workout-app/engine";
import type { SetLog } from "@workout-app/shared";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { ChipGroup } from "../components/ChipGroup";
import { LoadPicker } from "../components/LoadPicker";
import { Stepper } from "../components/Stepper";
import { ExerciseImage } from "../library/ExerciseImage";
import { liftDetail, type SessionView } from "../plan/sessions";
import { readSettings, type SettingsData } from "../settings/settings";
import { localDb, syncSoon } from "../sync";
import { button, buttonBase, card as cardClass } from "../ui";
import { useLiveQuery } from "../use-live-query";
import {
  bandChoices,
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
  weightStep,
  type LiftCard,
  type LiftSession,
  type PlayerPosition,
  type SetValues,
} from "./lift-log";

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

function ExerciseCard({
  view,
  card,
  settings,
  values,
  onValues,
  onLogged,
}: {
  view: SessionView;
  card: LiftCard;
  settings: SettingsData;
  values: SetValues;
  onValues: (values: SetValues) => void;
  onLogged: (done: boolean) => void;
}) {
  const titleId = useId();
  const [saving, setSaving] = useState(false);
  const { exercise, targets, sets } = card;
  const name = exercise?.name ?? "Pick an exercise";
  const done = sets.length >= targets.sets;
  const needsRir = targets.targetRir !== null;
  const unit = unitOf(card, settings);
  const weighted = isWeighted(card);
  const loads = weighted ? loadChoices(card, settings, values.load) : null;
  const bands = bandChoices(card, settings);
  const implement = implementOf(exercise);
  const unloadable = loads !== null && loads.length === 0;

  async function log() {
    setSaving(true);
    try {
      await logSet(localDb, view, card, values, settings);
      markActive(view.session.id);
      syncSoon();
      onLogged(sets.length + 1 >= targets.sets);
    } finally {
      setSaving(false);
    }
  }

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
      <ol aria-label="Sets" className="flex flex-col gap-1 tabular-nums">
        {sets.map((set) => (
          <li key={set.id} className="flex justify-between">
            <span className="text-fg-muted">Set {set.index + 1}</span>
            <span>{describeSet(set)}</span>
          </li>
        ))}
      </ol>
      {done ? (
        <p className="font-medium text-lift">All {targets.sets} sets done.</p>
      ) : (
        <section
          aria-label={`Set ${sets.length + 1} of ${targets.sets}`}
          className="flex flex-col gap-3"
        >
          <h3 className="font-semibold">
            Set {sets.length + 1} of {targets.sets}
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
 * unlogged values survive the app being killed.
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

  if (!data || !settings) return <section aria-label="Lift player" />;
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
  const go = (card: number) =>
    setPosition((p) => ({
      ...p,
      card: Math.min(Math.max(card, 0), cards.length - 1),
    }));
  const draft = position.drafts[current.itemId];
  const values = draft
    ? settle(current, settings, draft)
    : prefill(current, settings);

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
      <ExerciseCard
        key={current.itemId}
        view={view}
        card={current}
        settings={settings}
        values={values}
        onValues={(next) =>
          setPosition((p) => ({
            ...p,
            drafts: { ...p.drafts, [current.itemId]: next },
          }))
        }
        onLogged={(done) =>
          setPosition((p) => {
            const drafts = { ...p.drafts };
            delete drafts[current.itemId];
            const card = done && index < cards.length - 1 ? index + 1 : p.card;
            return { card, drafts };
          })
        }
      />
    </section>
  );
}
