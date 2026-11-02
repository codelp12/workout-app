import type { Exercise } from "@workout-app/shared";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { BottomSheet } from "../components/BottomSheet";
import { ChipGroup } from "../components/ChipGroup";
import { Loading, Skeleton } from "../components/Skeleton";
import { ExerciseImage } from "../library/ExerciseImage";
import {
  FACETS,
  facetOptions,
  readQuery,
  searchLibrary,
  vocabLabel,
  writeQuery,
  type Facet,
  type LibraryQuery,
} from "../library/filter";
import { modalityStyles } from "../modality";
import { localDb } from "../sync";
import { button, card, input } from "../ui";
import { useLiveQuery } from "../use-live-query";
import { Screen } from "./Screen";

const allExercises = () => localDb.rows("exercise").toArray();

export function Library() {
  const exercises = useLiveQuery<Exercise[] | undefined>(
    allExercises,
    undefined,
  );
  const [params, setParams] = useSearchParams();
  const query = readQuery(params);
  const live = useMemo(
    () => exercises?.filter((e) => e.deletedAt === null) ?? [],
    [exercises],
  );
  const results = useMemo(
    () => searchLibrary(live, readQuery(params)),
    [live, params],
  );
  const activeFilters = FACETS.reduce((n, f) => n + query[f.key].length, 0);

  const update = (next: LibraryQuery) =>
    setParams(writeQuery(next), { replace: true });
  const setFacet = (key: Facet, values: string[]) =>
    update({ ...query, [key]: values });

  if (!exercises)
    return (
      <Screen title="Library">
        <Loading label="Loading exercises">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </Loading>
      </Screen>
    );

  if (live.length === 0)
    return (
      <Screen title="Library">
        <p className={`${card} text-fg-muted`}>
          The exercise library downloads the first time you sync.
        </p>
      </Screen>
    );

  return (
    <Screen title="Library">
      <input
        type="search"
        aria-label="Search exercises"
        placeholder="Search exercises"
        className={`${input} min-h-tap`}
        value={query.q}
        onChange={(e) => update({ ...query, q: e.target.value })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <BottomSheet
          title="Filters"
          trigger={
            <button type="button" className={`${button} min-h-tap`}>
              {activeFilters ? `Filters (${activeFilters})` : "Filters"}
            </button>
          }
        >
          {FACETS.map((facet) => (
            <section key={facet.key} className="flex flex-col gap-2">
              <h2 className="font-semibold">{facet.label}</h2>
              <ChipGroup
                type="multiple"
                label={facet.label}
                options={facetOptions(live, facet.key).map((value) => ({
                  value,
                  label: vocabLabel(value),
                }))}
                value={query[facet.key]}
                onValueChange={(values) => setFacet(facet.key, values)}
              />
            </section>
          ))}
        </BottomSheet>
        {activeFilters > 0 && (
          <button
            type="button"
            className={`${button} min-h-tap`}
            onClick={() =>
              update({ q: query.q, muscle: [], equipment: [], pattern: [] })
            }
          >
            Clear filters
          </button>
        )}
        <p role="status" className="ml-auto text-sm text-fg-muted">
          {results.length === 1 ? "1 exercise" : `${results.length} exercises`}
        </p>
      </div>
      {results.length === 0 ? (
        <p className={`${card} text-fg-muted`}>No exercises match.</p>
      ) : (
        <ul aria-label="Exercises" className="flex flex-col gap-2">
          {results.map((e) => (
            <li key={e.id}>
              <Link
                to={`/library/${e.id}`}
                className={`${card} ${modalityStyles[e.modality].accent} flex min-h-tap items-center gap-3 p-2 active:bg-surface-raised`}
              >
                {e.media[0] ? (
                  <ExerciseImage
                    path={e.media[0].path}
                    alt=""
                    className="h-12 w-16 shrink-0"
                  />
                ) : (
                  <div className="h-12 w-16 shrink-0 rounded-md bg-surface-raised" />
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{e.name}</span>
                  <span className="truncate text-sm text-fg-muted">
                    {[...e.primaryMuscles, ...e.equipment]
                      .map(vocabLabel)
                      .join(" · ")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
