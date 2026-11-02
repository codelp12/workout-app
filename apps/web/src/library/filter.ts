import type { Exercise } from "@workout-app/shared";

/** The Library's search and filters, kept in the URL so Back restores them. */
export type LibraryQuery = {
  q: string;
  muscle: string[];
  equipment: string[];
  pattern: string[];
};

export type Facet = Exclude<keyof LibraryQuery, "q">;

export const FACETS: { key: Facet; label: string }[] = [
  { key: "muscle", label: "Muscle" },
  { key: "equipment", label: "Equipment" },
  { key: "pattern", label: "Movement pattern" },
];

const facetValues: Record<Facet, (e: Exercise) => readonly string[]> = {
  muscle: (e) => e.primaryMuscles,
  equipment: (e) => e.equipment,
  pattern: (e) => (e.movementPattern ? [e.movementPattern] : []),
};

export function readQuery(params: URLSearchParams): LibraryQuery {
  return {
    q: params.get("q") ?? "",
    muscle: params.getAll("muscle"),
    equipment: params.getAll("equipment"),
    pattern: params.getAll("pattern"),
  };
}

export function writeQuery(query: LibraryQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  for (const { key } of FACETS)
    for (const value of query[key]) params.append(key, value);
  return params;
}

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

function matchesSearch(exercise: Exercise, q: string): boolean {
  const terms = words(q);
  if (terms.length === 0) return true;
  const haystack = words([exercise.name, ...exercise.aliases].join(" "));
  return terms.every((term) => haystack.some((word) => word.startsWith(term)));
}

/**
 * Live exercises matching every search word (as a word prefix of the name or
 * an alias) and every filter, sorted by name. Within one filter any selected
 * value matches; across filters all must match.
 */
export function searchLibrary(
  exercises: readonly Exercise[],
  query: LibraryQuery,
): Exercise[] {
  return exercises
    .filter(
      (e) =>
        e.deletedAt === null &&
        matchesSearch(e, query.q) &&
        FACETS.every(
          ({ key }) =>
            query[key].length === 0 ||
            facetValues[key](e).some((v) => query[key].includes(v)),
        ),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every value a filter can take in this library, sorted by label. */
export function facetOptions(
  exercises: readonly Exercise[],
  facet: Facet,
): string[] {
  const values = new Set(exercises.flatMap(facetValues[facet]));
  return [...values].sort((a, b) => vocabLabel(a).localeCompare(vocabLabel(b)));
}

const SPECIAL_LABELS: Record<string, string> = {
  ez_bar: "EZ bar",
};

/** Display text for a snake_case vocabulary value: `lower_back` → "Lower back". */
export function vocabLabel(value: string): string {
  const special = SPECIAL_LABELS[value];
  if (special) return special;
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** URL of an exercise image; media paths are relative to the media root. */
export function exerciseImageUrl(path: string): string {
  return `/media/exercises/${path}`;
}
