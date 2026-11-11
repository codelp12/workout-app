import {
  defaultTemplateId,
  libraryExerciseId,
  type IntensityClass,
  type Intent,
  type Template,
  type TemplateSlot,
} from "@workout-app/shared";

type Slot = [
  sourceId: string,
  sets: number,
  repMin: number,
  repMax: number,
  targetRir: number,
  restSec: number,
];

export type DefaultTemplate = {
  key: string;
  name: string;
  intensityClass: IntensityClass;
  intent: Intent;
  slots: Slot[];
};

/**
 * Push/Pull/Legs A and B (SPEC §5.1), dumbbell-first, as free-exercise-db ids
 * with sets, rep range, target RIR and rest, following the owner's weekly
 * training program (DECISIONS.md). The first two slots of each are the main
 * lifts and `ramp` (SPEC §5.1 default). Lifting stays moderate because
 * climbing already trains pulling and grip. Legs A and Push B end with short
 * preventative hip work, and Legs B, after Sunday's long run, is a light hip
 * session. Heavy legs is the only key lifting session (SPEC §5.4). Holds
 * (side bridge, hip-flexor stretch) count seconds until sets can be timed.
 */
export const DEFAULT_TEMPLATES: readonly DefaultTemplate[] = [
  {
    key: "push_a",
    name: "Push A",
    intensityClass: "heavy",
    intent: "support",
    slots: [
      ["Dumbbell_Bench_Press", 3, 6, 10, 2, 180],
      ["Standing_Dumbbell_Press", 2, 8, 12, 2, 150],
      ["Side_Lateral_Raise", 2, 12, 15, 2, 60],
      ["Standing_Dumbbell_Triceps_Extension", 2, 10, 15, 2, 90],
    ],
  },
  {
    key: "push_b",
    name: "Push B",
    intensityClass: "moderate",
    intent: "support",
    slots: [
      ["Incline_Dumbbell_Press", 3, 8, 12, 2, 150],
      ["Seated_Dumbbell_Press", 2, 8, 12, 2, 150],
      ["Side_Lateral_Raise", 2, 12, 15, 2, 60],
      ["Standing_Dumbbell_Triceps_Extension", 2, 10, 15, 2, 90],
      ["Hip_Circles_prone", 2, 8, 12, 2, 45],
      ["Rear_Leg_Raises", 2, 8, 12, 2, 45],
      ["Hip_Flexion_with_Band", 2, 8, 12, 2, 45],
    ],
  },
  {
    key: "pull_a",
    name: "Pull A",
    intensityClass: "moderate",
    intent: "support",
    slots: [
      ["Dumbbell_Incline_Row", 2, 10, 12, 2, 150],
      ["Reverse_Flyes", 2, 12, 15, 2, 60],
      ["Dumbbell_Bicep_Curl", 1, 10, 12, 2, 60],
    ],
  },
  {
    key: "pull_b",
    name: "Pull B",
    intensityClass: "moderate",
    intent: "support",
    slots: [
      ["One-Arm_Dumbbell_Row", 2, 8, 12, 2, 150],
      ["Reverse_Flyes", 2, 12, 15, 2, 60],
      ["Hammer_Curls", 2, 10, 12, 2, 90],
    ],
  },
  {
    key: "legs_a",
    name: "Legs A",
    intensityClass: "heavy",
    intent: "key",
    slots: [
      ["Split_Squat_with_Dumbbells", 2, 8, 10, 2, 150],
      ["Kettlebell_One-Legged_Deadlift", 2, 8, 10, 2, 150],
      ["Butt_Lift_Bridge", 2, 10, 15, 2, 90],
      ["Standing_Dumbbell_Calf_Raise", 2, 12, 15, 2, 60],
      ["Side_Bridge", 2, 20, 30, 2, 60],
      ["Single_Leg_Glute_Bridge", 2, 8, 12, 2, 60],
    ],
  },
  {
    key: "legs_b",
    name: "Legs B",
    intensityClass: "light",
    intent: "recovery",
    slots: [
      ["Glute_Kickback", 2, 8, 12, 2, 45],
      ["Monster_Walk", 2, 8, 12, 2, 45],
      ["Side_Bridge", 2, 20, 30, 2, 60],
      ["Standing_Hip_Circles", 2, 8, 12, 2, 30],
      ["Kneeling_Hip_Flexor", 2, 20, 30, 2, 30],
    ],
  },
];

/**
 * Earlier versions of {@link DEFAULT_TEMPLATES}, oldest first. The server
 * upgrades a seeded template that still matches one of these exactly, so
 * templates the owner edited are left alone.
 */
export const PREVIOUS_DEFAULT_TEMPLATES: readonly (readonly DefaultTemplate[])[] =
  [
    [
      {
        key: "push_a",
        name: "Push A",
        intensityClass: "heavy",
        intent: "support",
        slots: [
          ["Dumbbell_Bench_Press", 3, 6, 10, 2, 180],
          ["Seated_Dumbbell_Press", 3, 6, 10, 2, 180],
          ["Incline_Dumbbell_Flyes", 3, 10, 15, 2, 90],
          ["Side_Lateral_Raise", 3, 12, 20, 1, 60],
          ["Lying_Dumbbell_Tricep_Extension", 3, 10, 15, 2, 90],
          ["Tricep_Dumbbell_Kickback", 2, 12, 20, 1, 60],
        ],
      },
      {
        key: "push_b",
        name: "Push B",
        intensityClass: "moderate",
        intent: "support",
        slots: [
          ["Incline_Dumbbell_Press", 3, 8, 12, 2, 150],
          ["Standing_Dumbbell_Press", 3, 8, 12, 2, 150],
          ["Dumbbell_Flyes", 3, 10, 15, 2, 90],
          ["Seated_Side_Lateral_Raise", 3, 12, 20, 1, 60],
          ["Standing_Dumbbell_Triceps_Extension", 3, 10, 15, 2, 90],
          ["Dips_-_Triceps_Version", 3, 6, 12, 2, 120],
        ],
      },
      {
        key: "pull_a",
        name: "Pull A",
        intensityClass: "heavy",
        intent: "support",
        slots: [
          ["One-Arm_Dumbbell_Row", 3, 6, 10, 2, 180],
          ["Pullups", 3, 5, 10, 2, 180],
          ["Seated_Bent-Over_Rear_Delt_Raise", 3, 12, 20, 1, 60],
          ["Dumbbell_Shrug", 3, 10, 15, 2, 90],
          ["Hammer_Curls", 3, 8, 12, 2, 90],
          ["Incline_Dumbbell_Curl", 2, 10, 15, 1, 60],
        ],
      },
      {
        key: "pull_b",
        name: "Pull B",
        intensityClass: "moderate",
        intent: "support",
        slots: [
          ["Dumbbell_Incline_Row", 3, 8, 12, 2, 150],
          ["Chin-Up", 3, 5, 10, 2, 150],
          ["Band_Pull_Apart", 3, 15, 25, 2, 60],
          ["Reverse_Flyes", 3, 12, 20, 1, 60],
          ["Dumbbell_Bicep_Curl", 3, 8, 12, 2, 90],
          ["Zottman_Curl", 2, 10, 15, 1, 60],
        ],
      },
      {
        key: "legs_a",
        name: "Legs A",
        intensityClass: "heavy",
        intent: "key",
        slots: [
          ["Dumbbell_Squat", 3, 6, 10, 2, 180],
          ["Stiff-Legged_Dumbbell_Deadlift", 3, 6, 10, 2, 180],
          ["Split_Squat_with_Dumbbells", 3, 8, 12, 2, 120],
          ["Single_Leg_Glute_Bridge", 3, 10, 15, 2, 60],
          ["Standing_Dumbbell_Calf_Raise", 3, 10, 15, 1, 60],
          // Plank holds count seconds until sets can be timed.
          ["Plank", 3, 30, 60, 2, 60],
        ],
      },
      {
        key: "legs_b",
        name: "Legs B",
        intensityClass: "moderate",
        intent: "support",
        slots: [
          ["Goblet_Squat", 3, 8, 12, 2, 150],
          ["Dumbbell_Rear_Lunge", 3, 8, 12, 2, 120],
          ["Dumbbell_Step_Ups", 3, 8, 12, 2, 120],
          ["Natural_Glute_Ham_Raise", 3, 5, 8, 2, 120],
          ["Calf_Raise_On_A_Dumbbell", 3, 10, 15, 1, 60],
          ["Hanging_Leg_Raise", 3, 8, 15, 2, 60],
        ],
      },
    ],
  ];

const RAMP_SLOTS = 2;

export type DefaultTemplateData = Pick<
  Template,
  "id" | "name" | "modality" | "intensityClass" | "intent" | "slots"
>;

/** The default templates as rows, with the same ids on every server. */
export function defaultTemplates(
  templates: readonly DefaultTemplate[] = DEFAULT_TEMPLATES,
): DefaultTemplateData[] {
  return templates.map((t) => ({
    id: defaultTemplateId(t.key),
    name: t.name,
    modality: "lift",
    intensityClass: t.intensityClass,
    intent: t.intent,
    slots: t.slots.map(
      ([sourceId, sets, repMin, repMax, targetRir, restSec], i) =>
        ({
          exerciseId: libraryExerciseId("free-exercise-db", sourceId),
          substitutionGroup: null,
          sets,
          repMin,
          repMax,
          targetRir,
          restSec,
          ramp: i < RAMP_SLOTS,
        }) satisfies TemplateSlot,
    ),
  }));
}
