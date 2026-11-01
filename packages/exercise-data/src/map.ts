// Maps a free-exercise-db entry onto our `exercise` row (SPEC §4, §7).
// The dataset has no aliases, movement patterns, stress tags or substitution
// groups, so those are derived from the name, category, equipment and
// muscles. The rules are deliberately simple; the curated core set (#37)
// is checked by hand on top of them.
import {
  STRESS_TAGS,
  type Exercise,
  type Modality,
  type ProgressionModel,
  type StressTag,
} from "@workout-app/shared";
import type { RawExercise, RawMuscle } from "./raw.js";

/** An exercise row without the sync columns, which seeding assigns. */
export type ExerciseData = Omit<
  Exercise,
  "id" | "userId" | "createdAt" | "updatedAt" | "deletedAt" | "serverSeq"
>;

export const MOVEMENT_PATTERNS = [
  "squat",
  "lunge",
  "hinge",
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
  "carry",
  "olympic",
  "jump",
  "curl",
  "triceps_extension",
  "raise",
  "fly",
  "leg_extension",
  "leg_curl",
  "calf_raise",
  "shrug",
  "core",
  "stretch",
] as const;
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

export const EQUIPMENT = [
  "barbell",
  "dumbbell",
  "bodyweight",
  "cable",
  "machine",
  "kettlebell",
  "band",
  "medicine_ball",
  "exercise_ball",
  "foam_roller",
  "ez_bar",
  "other",
] as const;
export type EquipmentKind = (typeof EQUIPMENT)[number];

const equipmentMap: Record<
  NonNullable<RawExercise["equipment"]>,
  EquipmentKind
> = {
  barbell: "barbell",
  dumbbell: "dumbbell",
  "body only": "bodyweight",
  cable: "cable",
  machine: "machine",
  kettlebells: "kettlebell",
  bands: "band",
  "medicine ball": "medicine_ball",
  "exercise ball": "exercise_ball",
  "foam roll": "foam_roller",
  "e-z curl bar": "ez_bar",
  other: "other",
};

/** Dataset muscle names in snake_case, e.g. `lower back` → `lower_back`. */
export function muscleName(muscle: RawMuscle): string {
  return muscle.replace(/ /g, "_");
}

type Rule = [MovementPattern, (name: string, raw: RawExercise) => boolean];

const has = (pattern: RegExp) => (name: string) => pattern.test(name);
const primary = (raw: RawExercise, ...muscles: RawMuscle[]) =>
  raw.primaryMuscles.some((m) => muscles.includes(m));

// First match wins, so more specific names come before general ones
// ("leg press" is a squat, not a press; "leg curl" isn't a biceps curl).
const patternRules: Rule[] = [
  ["stretch", (_, raw) => raw.category === "stretching"],
  ["jump", (_, raw) => raw.category === "plyometrics"],
  [
    "olympic",
    (name, raw) =>
      raw.category === "olympic weightlifting" ||
      (/\b(cleans?|jerks?|snatch(es)?|thrusters?)\b/.test(name) &&
        !/\bclean grip\b/.test(name)),
  ],
  ["carry", has(/\b(carry|farmer|yoke|suitcase)/)],
  [
    "calf_raise",
    (name, raw) => /\bcalf\b/.test(name) || primary(raw, "calves"),
  ],
  ["shrug", has(/\bshrug/)],
  ["leg_extension", has(/\bleg extension/)],
  ["leg_curl", has(/\b(leg curl|hamstring curl|glute[- ]ham raise|nordic)/)],
  [
    "hinge",
    has(
      /\b(deadlift|rdl|romanian|good morning|rack pull|hip thrust|glute bridge|bridge|swing|hyperextension|back extension|pull through)/,
    ),
  ],
  ["lunge", has(/\b(lunge|split squat|step[- ]?ups?\b|bulgarian)/)],
  ["squat", has(/\b(squat|leg press|hack)/)],
  [
    "vertical_pull",
    has(
      /\b(pull[- ]?ups?|chin[- ]?ups?|chins?|pull[- ]?downs?|muscle[- ]ups?)\b/,
    ),
  ],
  [
    "raise",
    (name, raw) =>
      /\bupright\b.*\brow\b/.test(name) ||
      (/\b(raises?|laterals?)\b/.test(name) && primary(raw, "shoulders")),
  ],
  ["horizontal_pull", has(/\b(rows?|face pulls?|pull aparts?)\b/)],
  ["fly", has(/\b(fly|flye|flyes|flys|crossover|pec deck)\b/)],
  ["curl", has(/\bcurls?\b/)],
  [
    "triceps_extension",
    (name, raw) =>
      primary(raw, "triceps") &&
      /\b(extension|pushdown|push-down|kickback|skull ?crusher)/.test(name),
  ],
  ["vertical_push", has(/\bdips?\b/)],
  [
    "vertical_push",
    (name, raw) =>
      /\b(press|push-?ups?|pushups?)\b/.test(name) &&
      (primary(raw, "shoulders") ||
        /\b(overhead|shoulder|military|arnold|push press|handstand)/.test(
          name,
        )),
  ],
  ["horizontal_push", has(/\b(press|push-?ups?|pushups?)\b/)],
  ["core", (_, raw) => primary(raw, "abdominals")],
];

export function movementPattern(raw: RawExercise): MovementPattern | null {
  const name = raw.name.toLowerCase();
  return patternRules.find(([, test]) => test(name, raw))?.[0] ?? null;
}

const patternStress: Partial<Record<MovementPattern, StressTag[]>> = {
  squat: ["knee", "hip"],
  lunge: ["knee", "hip"],
  hinge: ["low_back", "hip"],
  horizontal_push: ["shoulder", "elbow", "wrist"],
  vertical_push: ["shoulder", "elbow"],
  horizontal_pull: ["shoulder", "elbow"],
  vertical_pull: ["shoulder", "elbow"],
  carry: ["low_back", "wrist"],
  olympic: ["wrist", "shoulder", "low_back", "knee"],
  jump: ["knee", "shin", "ankle_foot"],
  curl: ["elbow", "wrist"],
  triceps_extension: ["elbow"],
  raise: ["shoulder"],
  fly: ["shoulder"],
  leg_extension: ["knee"],
  leg_curl: ["knee"],
  calf_raise: ["ankle_foot"],
  shrug: ["neck"],
};

const muscleStress: Partial<Record<RawMuscle, StressTag>> = {
  neck: "neck",
  shoulders: "shoulder",
  chest: "shoulder",
  biceps: "elbow",
  triceps: "elbow",
  forearms: "wrist",
  traps: "upper_back",
  "middle back": "upper_back",
  "lower back": "low_back",
  glutes: "hip",
  hamstrings: "hip",
  adductors: "hip",
  abductors: "hip",
  quadriceps: "knee",
  calves: "ankle_foot",
};

/** Body regions the exercise loads: its pattern's plus its primary muscles'. */
export function stressTags(
  raw: RawExercise,
  pattern: MovementPattern | null,
): StressTag[] {
  const tags = new Set<StressTag>(
    pattern ? (patternStress[pattern] ?? []) : [],
  );
  for (const muscle of raw.primaryMuscles) {
    const tag = muscleStress[muscle];
    if (tag) tags.add(tag);
  }
  return STRESS_TAGS.filter((tag) => tags.has(tag));
}

const unilateralName =
  /\b(one[- ]arm|single[- ]arm|one[- ]leg(ged)?|single[- ]leg|one[- ]hand(ed)?|single[- ]hand(ed)?|unilateral|lunges?|split squat|step[- ]?ups?|bulgarian|pistol)\b/;

export function isUnilateral(raw: RawExercise): boolean {
  return unilateralName.test(raw.name.toLowerCase());
}

const mainPatterns = new Set<MovementPattern>([
  "squat",
  "lunge",
  "hinge",
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
]);
const freeWeights = new Set<RawExercise["equipment"]>([
  "barbell",
  "dumbbell",
  "kettlebells",
  "e-z curl bar",
]);

/** SPEC §5.1: `e1rm_rir` for loaded main compounds, `double_progression` otherwise. */
export function progressionModel(
  raw: RawExercise,
  modality: Modality,
  pattern: MovementPattern | null,
): ProgressionModel | null {
  if (modality !== "lift") return null;
  return raw.mechanic === "compound" &&
    pattern !== null &&
    mainPatterns.has(pattern) &&
    freeWeights.has(raw.equipment)
    ? "e1rm_rir"
    : "double_progression";
}

/** Exercise group for swaps: pattern (or mechanic) plus the first primary muscle. */
export function substitutionGroup(
  raw: RawExercise,
  pattern: MovementPattern | null,
): string | null {
  const muscle = raw.primaryMuscles[0];
  if (!muscle) return null;
  return `${pattern ?? raw.mechanic ?? "other"}:${muscleName(muscle)}`;
}

const abbreviations: [RegExp, string][] = [
  [/\bDumbbells?\b/g, "DB"],
  [/\bBarbell\b/g, "BB"],
  [/\bKettlebells?\b/g, "KB"],
  [/\bRomanian Deadlift\b/g, "RDL"],
  [/\bOverhead Press\b/g, "OHP"],
];

/** Short forms people search for, e.g. "DB Bench Press". */
export function aliases(name: string): string[] {
  const short = abbreviations.reduce(
    (text, [pattern, abbreviation]) => text.replace(pattern, abbreviation),
    name,
  );
  return short === name ? [] : [short];
}

export interface Provenance {
  /** e.g. `free-exercise-db@<commit>`. */
  source: string;
  license: string;
}

/**
 * Maps one dataset entry, or returns null for entries we don't import:
 * cardio machines and running (14 entries), since runs are logged as
 * `run_log` with their own workout content (SPEC §4, §7).
 */
export function mapExercise(
  raw: RawExercise,
  provenance: Provenance,
): ExerciseData | null {
  if (raw.category === "cardio") return null;
  const modality: Modality =
    raw.category === "stretching" ? "mobility" : "lift";
  const pattern = movementPattern(raw);
  const progression = progressionModel(raw, modality, pattern);
  return {
    name: raw.name,
    aliases: aliases(raw.name),
    modality,
    movementPattern: pattern,
    primaryMuscles: raw.primaryMuscles.map(muscleName),
    secondaryMuscles: raw.secondaryMuscles.map(muscleName),
    equipment: raw.equipment ? [equipmentMap[raw.equipment]] : [],
    mechanic: raw.mechanic,
    unilateral: isUnilateral(raw),
    progressionModel: progression,
    // Null means "the equipment's default step" (SPEC §5.1); per-exercise
    // overrides come from the owner.
    increment: null,
    repMin: progression === "double_progression" ? 8 : null,
    repMax: progression === "double_progression" ? 12 : null,
    stressTags: stressTags(raw, pattern),
    substitutionGroup: substitutionGroup(raw, pattern),
    instructions: raw.instructions,
    cues: [],
    commonMistakes: [],
    media: raw.images.map((path) => ({ kind: "image", path, ...provenance })),
    ...provenance,
    sourceId: raw.id,
  };
}
