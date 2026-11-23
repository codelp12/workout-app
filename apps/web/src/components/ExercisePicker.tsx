import type { Exercise } from "@workout-app/shared";
import { useState, type ReactNode } from "react";
import { searchLibrary } from "../library/filter";
import { input } from "../ui";

const MAX_RESULTS = 30;

/** Search the library and tap an exercise to pick it. */
export function ExercisePicker({
  exercises,
  onPick,
  browse = true,
  suggestions,
}: {
  exercises: readonly Exercise[];
  onPick: (exercise: Exercise) => void;
  /** List exercises before anything is typed. */
  browse?: boolean;
  suggestions?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const searching = q.trim() !== "";
  const results =
    browse || searching
      ? searchLibrary(exercises, {
          q,
          muscle: [],
          equipment: [],
          pattern: [],
        }).slice(0, MAX_RESULTS)
      : [];
  return (
    <>
      <input
        type="search"
        aria-label="Search exercises"
        placeholder="Search exercises"
        className={`${input} min-h-tap`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {exercises.length === 0 ? (
        <p className="text-fg-muted">
          The library arrives with your first sync.
        </p>
      ) : results.length > 0 ? (
        <ul aria-label="Exercises" className="flex flex-col gap-1">
          {results.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="min-h-tap w-full rounded-lg px-3 text-left active:bg-surface-raised"
                onClick={() => {
                  setQ("");
                  onPick(e);
                }}
              >
                {e.name}
              </button>
            </li>
          ))}
        </ul>
      ) : searching ? (
        <p role="status" className="text-fg-muted">
          No matching exercises.
        </p>
      ) : null}
      {!searching && suggestions}
    </>
  );
}
