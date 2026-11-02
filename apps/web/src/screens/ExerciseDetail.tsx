import type { Exercise } from "@workout-app/shared";
import { useCallback, useId, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Loading, Skeleton } from "../components/Skeleton";
import { useToast } from "../components/toast-context";
import { ExerciseImage } from "../library/ExerciseImage";
import { vocabLabel } from "../library/filter";
import { localDb, save } from "../sync";
import { button, card, input } from "../ui";
import { useLiveQuery } from "../use-live-query";
import { Screen } from "./Screen";

function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <button
      type="button"
      className={`${button} min-h-tap self-start`}
      // Back keeps the Library's search and filters; a deep link has no history.
      onClick={() =>
        void (location.key === "default" ? navigate("/library") : navigate(-1))
      }
    >
      Back
    </button>
  );
}

function ListSection({
  title,
  items,
  ordered = false,
}: {
  title: string;
  items: readonly string[];
  ordered?: boolean;
}) {
  const id = useId();
  if (items.length === 0) return null;
  const List = ordered ? "ol" : "ul";
  return (
    <section aria-labelledby={id} className={`${card} flex flex-col gap-2`}>
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      <List
        className={`flex flex-col gap-2 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}
      >
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </List>
    </section>
  );
}

function Facts({ exercise: e }: { exercise: Exercise }) {
  const facts: [string, readonly string[]][] = [
    ["Primary muscles", e.primaryMuscles],
    ["Secondary muscles", e.secondaryMuscles],
    ["Equipment", e.equipment],
    ["Movement pattern", e.movementPattern ? [e.movementPattern] : []],
    ["Mechanic", e.mechanic ? [e.mechanic] : []],
  ];
  return (
    <dl className={`${card} grid grid-cols-[auto_1fr] gap-x-4 gap-y-1`}>
      {facts
        .filter(([, values]) => values.length > 0)
        .map(([label, values]) => (
          <div key={label} className="contents">
            <dt className="text-fg-muted">{label}</dt>
            <dd>{values.map(vocabLabel).join(", ")}</dd>
          </div>
        ))}
      {e.unilateral && (
        <div className="contents">
          <dt className="text-fg-muted">Sides</dt>
          <dd>One at a time</dd>
        </div>
      )}
    </dl>
  );
}

function Photos({ exercise: e }: { exercise: Exercise }) {
  const images = e.media.filter((m) => m.kind === "image");
  if (images.length === 0) return null;
  const credit = images[0]!;
  return (
    <figure className="flex flex-col gap-1">
      <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto">
        {images.map((m, i) => (
          <ExerciseImage
            key={m.path}
            path={m.path}
            alt={`${e.name}, photo ${i + 1} of ${images.length}`}
            className="aspect-[4/3] w-full shrink-0 snap-center"
          />
        ))}
      </div>
      <figcaption className="text-xs text-fg-muted">
        Photos: {credit.source.split("@")[0]}, {credit.license}
      </figcaption>
    </figure>
  );
}

function Notes({ exercise }: { exercise: Exercise }) {
  const toast = useToast();
  const id = useId();
  const saved = exercise.notes ?? "";
  const [draft, setDraft] = useState(saved);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const notes = draft.trim();
    await save("exercise", {
      ...exercise,
      notes: notes || null,
      updatedAt: Date.now(),
    });
    setDraft(notes);
    toast({ title: "Notes saved" });
  }

  return (
    <form
      className={`${card} flex flex-col gap-2`}
      onSubmit={(event) => void onSubmit(event)}
    >
      <label htmlFor={id} className="font-semibold">
        Personal notes
      </label>
      <textarea
        id={id}
        rows={4}
        className={`${input} py-2`}
        placeholder="Seat height, grip, what to watch for…"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        type="submit"
        className={`${button} min-h-tap self-end`}
        disabled={draft.trim() === saved}
      >
        Save notes
      </button>
    </form>
  );
}

/** One exercise: photos, facts, how-to and the owner's notes (SPEC §6.8). */
export function ExerciseDetail() {
  const { id = "" } = useParams();
  const query = useCallback(
    async () => (await localDb.rows("exercise").get(id)) ?? null,
    [id],
  );
  const exercise = useLiveQuery<Exercise | null | undefined>(query, undefined);

  if (exercise === undefined)
    return (
      <Screen title="Exercise">
        <Loading label="Loading exercise">
          <Skeleton className="aspect-[4/3] w-full" />
          <Skeleton className="h-24 w-full" />
        </Loading>
      </Screen>
    );

  if (!exercise || exercise.deletedAt !== null)
    return (
      <Screen title="Exercise not found">
        <BackButton />
        <p className={`${card} text-fg-muted`}>
          This exercise isn't on this device.
        </p>
      </Screen>
    );

  return (
    <Screen title={exercise.name}>
      <BackButton />
      <Photos exercise={exercise} />
      <Facts exercise={exercise} />
      <ListSection title="Instructions" items={exercise.instructions} ordered />
      <ListSection title="Cues" items={exercise.cues} />
      <ListSection title="Common mistakes" items={exercise.commonMistakes} />
      <Notes key={exercise.id} exercise={exercise} />
    </Screen>
  );
}
