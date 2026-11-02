import { GRADE_SCALES, roundToLoadable } from "@workout-app/engine";
import {
  MAIN_LIFTS,
  type ClimbDiscipline,
  type Onboarding as Answers,
} from "@workout-app/shared";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ChipGroup } from "../components/ChipGroup";
import { Skeleton } from "../components/Skeleton";
import { Stepper } from "../components/Stepper";
import { EquipmentEditor } from "../settings/EquipmentEditor";
import { markOnboardingOffered } from "../settings/onboarding-flag";
import { Section, Subsection } from "../settings/Sections";
import {
  readSettings,
  updateSettings,
  type SettingsData,
} from "../settings/settings";
import { button, buttonBase, toggle } from "../ui";
import { useLiveQuery } from "../use-live-query";
import { Screen } from "./Screen";

type Lift = { load: number; reps: number; rir: number };
type Run = {
  distance: number;
  minutes: number;
  seconds: number;
  rpe: number;
  weekly: number;
};
type Climb = { discipline: ClimbDiscipline; limit: string; volume: string };

const STEPS = ["Equipment", "Lifts", "Running", "Climbing"] as const;

const DEFAULT_GRADES: Record<ClimbDiscipline, [string, string]> = {
  boulder: ["V4", "V2"],
  route: ["5.11a", "5.10a"],
};

const options = (values: readonly (string | number)[]) =>
  values.map((v) => ({ value: String(v), label: String(v) }));

function Included({
  label,
  on,
  onChange,
  children,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <>
      <button
        type="button"
        className={`${toggle} self-start`}
        aria-pressed={on}
        onClick={() => onChange(!on)}
      >
        {label}
      </button>
      {on && children}
    </>
  );
}

function LiftsStep({
  settings,
  lifts,
  setLifts,
}: {
  settings: SettingsData;
  lifts: Map<string, Lift>;
  setLifts: (lifts: Map<string, Lift>) => void;
}) {
  const unit = settings.weightUnit;
  const rack = settings.equipment.dumbbells;
  const loadable = (w: number) =>
    roundToLoadable(settings.equipment, "dumbbell", w) ?? w;
  const set = (id: string, lift: Lift | null) => {
    const next = new Map(lifts);
    if (lift) next.set(id, lift);
    else next.delete(id);
    setLifts(next);
  };
  return (
    <>
      <p className="text-fg-muted">
        A recent working set for each main lift: weight per dumbbell, reps, and
        how many more reps you had left (reps in reserve). Leave out any you
        haven&apos;t done lately.
      </p>
      {MAIN_LIFTS.map(({ exerciseId, name }) => {
        const lift = lifts.get(exerciseId);
        return (
          <Section key={exerciseId} title={name}>
            <Included
              label={`I know my ${name.toLowerCase()} weight`}
              on={!!lift}
              onChange={(on) =>
                set(
                  exerciseId,
                  on ? { load: loadable(25), reps: 8, rir: 2 } : null,
                )
              }
            >
              {lift && (
                <>
                  <Stepper
                    label={`${name} weight`}
                    value={lift.load}
                    step={rack?.step ?? 5}
                    min={rack?.min ?? 0}
                    max={rack?.max}
                    unit={unit}
                    onValueChange={(w) =>
                      set(exerciseId, { ...lift, load: loadable(w) })
                    }
                  />
                  <Stepper
                    label={`${name} reps`}
                    value={lift.reps}
                    min={1}
                    max={30}
                    onValueChange={(reps) => set(exerciseId, { ...lift, reps })}
                  />
                  <ChipGroup
                    type="single"
                    label={`${name} reps in reserve`}
                    options={options([0, 1, 2, 3, 4])}
                    modality="lift"
                    value={String(lift.rir)}
                    onValueChange={(v) =>
                      set(exerciseId, { ...lift, rir: Number(v) })
                    }
                  />
                </>
              )}
            </Included>
          </Section>
        );
      })}
    </>
  );
}

function RunStep({
  settings,
  run,
  setRun,
}: {
  settings: SettingsData;
  run: Run | null;
  setRun: (run: Run | null) => void;
}) {
  const unit = settings.distanceUnit;
  return (
    <Section title="A recent run">
      <p className="text-sm text-fg-muted">
        Your best recent hard effort, like a 5K or a 30-minute run, and how much
        you run in a typical week.
      </p>
      <Included
        label="Add a recent run"
        on={!!run}
        onChange={(on) =>
          setRun(
            on
              ? {
                  distance: unit === "mi" ? 3.1 : 5,
                  minutes: 25,
                  seconds: 0,
                  rpe: 8,
                  weekly: unit === "mi" ? 10 : 16,
                }
              : null,
          )
        }
      >
        {run && (
          <>
            <Stepper
              label="Distance"
              value={run.distance}
              step={0.1}
              min={0.1}
              unit={unit}
              onValueChange={(distance) => setRun({ ...run, distance })}
            />
            <div className="grid grid-cols-2 gap-2">
              <Stepper
                label="Minutes"
                value={run.minutes}
                min={0}
                onValueChange={(minutes) => setRun({ ...run, minutes })}
              />
              <Stepper
                label="Seconds"
                value={run.seconds}
                min={0}
                max={59}
                onValueChange={(seconds) => setRun({ ...run, seconds })}
              />
            </div>
            <Subsection title="How hard was it? (RPE)">
              <ChipGroup
                type="single"
                label="Run effort (RPE)"
                options={options([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])}
                modality="run"
                value={String(run.rpe)}
                onValueChange={(v) => setRun({ ...run, rpe: Number(v) })}
              />
            </Subsection>
            <Stepper
              label="Weekly distance"
              value={run.weekly}
              step={1}
              min={0}
              unit={unit}
              onValueChange={(weekly) => setRun({ ...run, weekly })}
            />
          </>
        )}
      </Included>
    </Section>
  );
}

function ClimbStep({
  climb,
  setClimb,
}: {
  climb: Climb | null;
  setClimb: (climb: Climb | null) => void;
}) {
  const discipline = (d: ClimbDiscipline): Climb => ({
    discipline: d,
    limit: DEFAULT_GRADES[d][0],
    volume: DEFAULT_GRADES[d][1],
  });
  return (
    <Section title="Climbing grades">
      <p className="text-sm text-fg-muted">
        Your limit grade is the hardest you&apos;ve sent in the last six weeks;
        your volume grade is the hardest you can send three of in a session.
      </p>
      <Included
        label="I climb"
        on={!!climb}
        onChange={(on) => setClimb(on ? discipline("boulder") : null)}
      >
        {climb && (
          <>
            <ChipGroup
              type="single"
              label="Discipline"
              options={[
                { value: "boulder", label: "Bouldering" },
                { value: "route", label: "Routes" },
              ]}
              modality="climb"
              value={climb.discipline}
              onValueChange={(d) => setClimb(discipline(d))}
            />
            <Subsection title="Limit grade">
              <ChipGroup
                type="single"
                label="Limit grade"
                options={options(GRADE_SCALES[climb.discipline])}
                modality="climb"
                value={climb.limit}
                onValueChange={(limit) => setClimb({ ...climb, limit })}
              />
            </Subsection>
            <Subsection title="Volume grade">
              <ChipGroup
                type="single"
                label="Volume grade"
                options={options(GRADE_SCALES[climb.discipline])}
                modality="climb"
                value={climb.volume}
                onValueChange={(volume) => setClimb({ ...climb, volume })}
              />
            </Subsection>
          </>
        )}
      </Included>
    </Section>
  );
}

function fromAnswers(answers: Answers | null) {
  const lifts = new Map<string, Lift>(
    (answers?.lifts ?? []).map((l) => [
      l.exerciseId,
      { load: l.load.value, reps: l.reps, rir: l.rir },
    ]),
  );
  const r = answers?.run;
  const run: Run | null = r
    ? {
        distance: r.distanceValue,
        minutes: Math.floor(r.durationSec / 60),
        seconds: r.durationSec % 60,
        rpe: r.rpe,
        weekly: r.weeklyDistance,
      }
    : null;
  const c = answers?.climb;
  const climb: Climb | null = c
    ? { discipline: c.discipline, limit: c.limitGrade, volume: c.volumeGrade }
    : null;
  return { lifts, run, climb };
}

function Wizard({ settings }: { settings: SettingsData }) {
  const navigate = useNavigate();
  const [initial] = useState(() => fromAnswers(settings.onboarding));
  const [step, setStep] = useState(0);
  const [lifts, setLifts] = useState(initial.lifts);
  const [run, setRun] = useState(initial.run);
  const [climb, setClimb] = useState(initial.climb);
  const last = step === STEPS.length - 1;

  function leave() {
    markOnboardingOffered();
    void navigate("/");
  }

  async function finish() {
    await updateSettings((s) => ({
      onboarding: {
        completedAt: Date.now(),
        lifts: MAIN_LIFTS.flatMap(({ exerciseId }) => {
          const lift = lifts.get(exerciseId);
          return lift
            ? [
                {
                  exerciseId,
                  load: { value: lift.load, unit: s.weightUnit },
                  reps: lift.reps,
                  rir: lift.rir,
                },
              ]
            : [];
        }),
        run: run && {
          distanceValue: run.distance,
          distanceUnit: s.distanceUnit,
          durationSec: Math.max(1, run.minutes * 60 + run.seconds),
          rpe: run.rpe,
          weeklyDistance: run.weekly,
        },
        climb: climb && {
          discipline: climb.discipline,
          limitGrade: climb.limit,
          volumeGrade: climb.volume,
        },
      },
    }));
    leave();
  }

  return (
    <>
      <p className="text-fg-muted" aria-live="polite">
        Step {step + 1} of {STEPS.length}: {STEPS[step]}
      </p>
      {step === 0 && (
        <Section title="Your equipment">
          <p className="text-sm text-fg-muted">
            The coach only prescribes weights you can load. Change anything that
            doesn&apos;t match your gym; Settings has the rest.
          </p>
          <EquipmentEditor settings={settings} />
        </Section>
      )}
      {step === 1 && (
        <LiftsStep settings={settings} lifts={lifts} setLifts={setLifts} />
      )}
      {step === 2 && <RunStep settings={settings} run={run} setRun={setRun} />}
      {step === 3 && <ClimbStep climb={climb} setClimb={setClimb} />}
      <div className="flex gap-2">
        {step > 0 && (
          <button
            type="button"
            className={`${button} min-h-tap flex-1`}
            onClick={() => setStep(step - 1)}
          >
            Back
          </button>
        )}
        <button
          type="button"
          className={`${buttonBase} min-h-tap flex-1 bg-accent text-bg`}
          onClick={() => (last ? void finish() : setStep(step + 1))}
        >
          {last ? "Finish" : "Next"}
        </button>
      </div>
      <button
        type="button"
        className={`${button} min-h-tap self-center`}
        onClick={leave}
      >
        Skip for now
      </button>
    </>
  );
}

/** First-run setup (SPEC §5.0): equipment, working weights, a run and grades. */
export function Onboarding() {
  const settings = useLiveQuery(readSettings, null);
  return (
    <Screen title="Set up">
      {settings ? (
        <Wizard settings={settings} />
      ) : (
        <Skeleton className="h-96" />
      )}
    </Screen>
  );
}
