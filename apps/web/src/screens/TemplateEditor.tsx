import { isTemplateModality } from "@workout-app/shared";
import type {
  Exercise,
  IntensityClass,
  Intent,
  Template,
  TemplateSlot,
} from "@workout-app/shared";
import { useCallback, useId, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BottomSheet } from "../components/BottomSheet";
import { ChipGroup } from "../components/ChipGroup";
import { Loading, Skeleton } from "../components/Skeleton";
import { Stepper } from "../components/Stepper";
import { searchLibrary, vocabLabel } from "../library/filter";
import { Section, Subsection } from "../settings/Sections";
import { localDb } from "../sync";
import {
  readTemplate,
  updateSlot,
  updateTemplate,
} from "../templates/templates";
import { button, card, input, toggle } from "../ui";
import { useLiveQuery } from "../use-live-query";
import { Screen } from "./Screen";

const INTENSITIES: { value: IntensityClass; label: string }[] = [
  { value: "heavy", label: "Heavy" },
  { value: "moderate", label: "Moderate" },
  { value: "light", label: "Light" },
];
const INTENTS: { value: Intent; label: string }[] = [
  { value: "key", label: "Key" },
  { value: "support", label: "Support" },
  { value: "recovery", label: "Recovery" },
];
const RIR_OPTIONS = [0, 1, 2, 3, 4].map((n) => ({
  value: String(n),
  label: String(n),
}));

const MAX_RESULTS = 30;

type Names = ReadonlyMap<string, string>;

const slotName = (slot: TemplateSlot, names: Names) =>
  slot.exerciseId !== null
    ? (names.get(slot.exerciseId) ?? "Exercise not synced yet")
    : `Any ${vocabLabel(slot.substitutionGroup ?? "exercise")}`;

function BackButton() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className={`${button} min-h-tap self-start`}
      onClick={() => void navigate("/settings")}
    >
      Back
    </button>
  );
}

function NameField({ template }: { template: Template }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  function commit() {
    const name = draft?.trim();
    setDraft(null);
    if (name && name !== template.name) {
      void updateTemplate(template.id, () => ({ name }));
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>Name</label>
      <input
        id={id}
        className={`${input} min-h-tap`}
        value={draft ?? template.name}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
    </div>
  );
}

function SlotCard({
  template,
  index,
  names,
}: {
  template: Template;
  index: number;
  names: Names;
}) {
  const headingId = useId();
  const slot = template.slots[index];
  if (!slot) return null;
  const name = slotName(slot, names);
  const last = template.slots.length - 1;
  const set = (change: Partial<TemplateSlot>) =>
    void updateSlot(template.id, index, () => change);
  const move = (to: number) =>
    void updateTemplate(template.id, (t) => {
      const slots = [...t.slots];
      const [moved] = slots.splice(index, 1);
      if (moved) slots.splice(to, 0, moved);
      return { slots };
    });

  return (
    <li>
      <section
        aria-labelledby={headingId}
        className="flex flex-col gap-3 rounded-lg bg-surface-raised p-3"
      >
        <h3 id={headingId} className="font-medium">
          {index + 1}. {name}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <Stepper
            label="Sets"
            value={slot.sets}
            min={1}
            max={10}
            onValueChange={(sets) => set({ sets })}
          />
          <Stepper
            label="Rest"
            unit="s"
            step={15}
            value={slot.restSec}
            max={600}
            onValueChange={(restSec) => set({ restSec })}
          />
          <Stepper
            label="Min reps"
            value={slot.repMin}
            min={1}
            max={100}
            onValueChange={(repMin) =>
              set({ repMin, repMax: Math.max(repMin, slot.repMax) })
            }
          />
          <Stepper
            label="Max reps"
            value={slot.repMax}
            min={1}
            max={100}
            onValueChange={(repMax) =>
              set({ repMax, repMin: Math.min(repMax, slot.repMin) })
            }
          />
        </div>
        <div className="flex flex-col gap-1">
          <span>Reps in reserve</span>
          <ChipGroup
            type="single"
            label="Reps in reserve"
            modality="lift"
            options={RIR_OPTIONS}
            value={slot.targetRir === null ? undefined : String(slot.targetRir)}
            onValueChange={(v) => set({ targetRir: Number(v) })}
          />
        </div>
        <button
          type="button"
          className={`${toggle} self-start`}
          aria-pressed={slot.ramp}
          onClick={() => set({ ramp: !slot.ramp })}
        >
          Add a set in loading weeks
        </button>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`${button} min-h-tap`}
            aria-label={`Move ${name} up`}
            disabled={index === 0}
            onClick={() => move(index - 1)}
          >
            Up
          </button>
          <button
            type="button"
            className={`${button} min-h-tap`}
            aria-label={`Move ${name} down`}
            disabled={index === last}
            onClick={() => move(index + 1)}
          >
            Down
          </button>
          <button
            type="button"
            className={`${button} min-h-tap`}
            aria-label={`Remove ${name}`}
            onClick={() =>
              void updateTemplate(template.id, (t) => ({
                slots: t.slots.filter((_, i) => i !== index),
              }))
            }
          >
            Remove
          </button>
        </div>
      </section>
    </li>
  );
}

function AddExercise({
  template,
  exercises,
}: {
  template: Template;
  exercises: readonly Exercise[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const lifts = exercises.filter((e) => isTemplateModality(e.modality));
  const results = searchLibrary(lifts, {
    q,
    muscle: [],
    equipment: [],
    pattern: [],
  }).slice(0, MAX_RESULTS);

  function add(exercise: Exercise) {
    setOpen(false);
    setQ("");
    void updateTemplate(template.id, (t) => ({
      slots: [
        ...t.slots,
        {
          exerciseId: exercise.id,
          substitutionGroup: null,
          sets: 3,
          repMin: exercise.repMin ?? 8,
          repMax: exercise.repMax ?? 12,
          targetRir: 2,
          restSec: 90,
          ramp: false,
        },
      ],
    }));
  }

  return (
    <BottomSheet
      title="Add an exercise"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={`${button} min-h-tap self-start`}>
          Add exercise
        </button>
      }
    >
      <input
        type="search"
        aria-label="Search exercises"
        placeholder="Search exercises"
        className={`${input} min-h-tap`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {lifts.length === 0 ? (
        <p className="text-fg-muted">
          The library arrives with your first sync.
        </p>
      ) : (
        <ul aria-label="Exercises" className="flex flex-col gap-1">
          {results.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="min-h-tap w-full rounded-lg px-3 text-left active:bg-surface-raised"
                onClick={() => add(e)}
              >
                {e.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </BottomSheet>
  );
}

function Editor({
  template,
  exercises,
}: {
  template: Template;
  exercises: readonly Exercise[];
}) {
  const names: Names = new Map(exercises.map((e) => [e.id, e.name]));
  return (
    <>
      <Section title="Template">
        <NameField template={template} />
        <Subsection title="Intensity">
          <ChipGroup
            type="single"
            label="Intensity"
            options={INTENSITIES}
            value={template.intensityClass}
            onValueChange={(intensityClass) =>
              void updateTemplate(template.id, () => ({ intensityClass }))
            }
          />
        </Subsection>
        <Subsection title="Intent">
          <ChipGroup
            type="single"
            label="Intent"
            options={INTENTS}
            value={template.intent}
            onValueChange={(intent) =>
              void updateTemplate(template.id, () => ({ intent }))
            }
          />
        </Subsection>
        <p className="text-sm text-fg-muted">
          The planner uses intensity and intent to space hard days apart.
        </p>
      </Section>
      <Section title="Exercises">
        {template.slots.length === 0 ? (
          <p className="text-fg-muted">No exercises yet.</p>
        ) : (
          <ol aria-label="Exercises" className="flex flex-col gap-3">
            {template.slots.map((slot, i) => (
              <SlotCard
                // Index keys: slots have no ids, and moving rebuilds the list.
                key={`${i}-${slot.exerciseId ?? slot.substitutionGroup}`}
                template={template}
                index={i}
                names={names}
              />
            ))}
          </ol>
        )}
        <AddExercise template={template} exercises={exercises} />
      </Section>
    </>
  );
}

const allExercises = () => localDb.rows("exercise").toArray();

/** Edit one template's details and exercises (SPEC §4, §6.9). Changes save as you make them. */
export function TemplateEditor() {
  const { id = "" } = useParams();
  const template = useLiveQuery<Template | null | undefined>(
    useCallback(() => readTemplate(id), [id]),
    undefined,
  );
  const exercises = useLiveQuery<Exercise[] | undefined>(
    allExercises,
    undefined,
  );
  return (
    <Screen title={template?.name ?? "Template"}>
      <BackButton />
      {template === undefined || exercises === undefined ? (
        <Loading label="Loading template">
          <Skeleton className="h-96" />
        </Loading>
      ) : template === null ? (
        <p className={`${card} text-fg-muted`}>This template doesn't exist.</p>
      ) : (
        <Editor template={template} exercises={exercises} />
      )}
    </Screen>
  );
}
