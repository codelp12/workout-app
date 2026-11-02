// The curated core set (SPEC §7): the exercises the default templates use,
// their dumbbell, band and bodyweight substitutes first, plus core work and
// mobility. Their images are converted by `scripts/images.ts` and committed
// under `media/`, so they can be pre-cached for offline use; the rest of the
// library loads on demand. Ids are free-exercise-db ids (`sourceId`).

import { DEFAULT_TEMPLATES } from "./templates.js";

/**
 * Exercises for the default Push/Pull/Legs A and B templates (SPEC §5.1),
 * dumbbell-first, in session order, keyed by template name.
 */
export const DEFAULT_TEMPLATE_EXERCISES: Readonly<
  Record<string, readonly string[]>
> = Object.fromEntries(
  DEFAULT_TEMPLATES.map((t) => [t.name, t.slots.map(([sourceId]) => sourceId)]),
);

const substitutes = {
  push: [
    "Dumbbell_Bench_Press_with_Neutral_Grip",
    "Decline_Dumbbell_Bench_Press",
    "Dumbbell_Floor_Press",
    "Close-Grip_Dumbbell_Press",
    "Hammer_Grip_Incline_DB_Bench_Press",
    "One_Arm_Dumbbell_Bench_Press",
    "Arnold_Dumbbell_Press",
    "Dumbbell_One-Arm_Shoulder_Press",
    "Standing_Palms-In_Dumbbell_Press",
    "Standing_Alternating_Dumbbell_Press",
    "Pushups",
    "Push-Ups_With_Feet_Elevated",
    "Incline_Push-Up",
    "Push-Ups_-_Close_Triceps_Position",
    "Bench_Dips",
    "Decline_Dumbbell_Flyes",
    "One-Arm_Flat_Bench_Dumbbell_Flye",
    "Bench_Press_-_With_Bands",
    "Shoulder_Press_-_With_Bands",
    "Cross_Over_-_With_Bands",
    "Lateral_Raise_-_With_Bands",
    "Front_Dumbbell_Raise",
    "One-Arm_Side_Laterals",
    "Standing_Dumbbell_Upright_Row",
    "Upright_Row_-_With_Bands",
    "Dumbbell_One-Arm_Triceps_Extension",
    "Standing_One-Arm_Dumbbell_Triceps_Extension",
    "Seated_Bent-Over_Two-Arm_Dumbbell_Triceps_Extension",
    "Tate_Press",
    "Band_Skull_Crusher",
    "EZ-Bar_Skullcrusher",
    "Triceps_Pushdown",
  ],
  pull: [
    "Bent_Over_Two-Dumbbell_Row",
    "Bent_Over_Two-Dumbbell_Row_With_Palms_In",
    "Alternating_Renegade_Row",
    "Two-Arm_Kettlebell_Row",
    "One-Arm_Kettlebell_Row",
    "V-Bar_Pullup",
    "Wide-Grip_Lat_Pulldown",
    "Close-Grip_Front_Lat_Pulldown",
    "Seated_Cable_Rows",
    "Face_Pull",
    "Back_Flyes_-_With_Bands",
    "Reverse_Flyes_With_External_Rotation",
    "Bent_Over_Dumbbell_Rear_Delt_Raise_With_Head_On_Bench",
    "Lying_Rear_Delt_Raise",
    "External_Rotation_with_Band",
    "External_Rotation",
    "Bent-Arm_Dumbbell_Pullover",
    "Straight-Arm_Dumbbell_Pullover",
    "Middle_Back_Shrug",
    "Dumbbell_Alternate_Bicep_Curl",
    "Alternate_Hammer_Curl",
    "Cross_Body_Hammer_Curl",
    "Concentration_Curls",
    "One_Arm_Dumbbell_Preacher_Curl",
    "Dumbbell_Prone_Incline_Curl",
    "Seated_Dumbbell_Curl",
    "Standing_Dumbbell_Reverse_Curl",
    "Barbell_Curl",
    "EZ-Bar_Curl",
    "Seated_Dumbbell_Palms-Up_Wrist_Curl",
    "Farmers_Walk",
  ],
  legs: [
    "Dumbbell_Lunges",
    "Dumbbell_Squat_To_A_Bench",
    "Plie_Dumbbell_Squat",
    "Bodyweight_Squat",
    "Front_Squats_With_Two_Kettlebells",
    "Squats_-_With_Bands",
    "Step-up_with_Knee_Raise",
    "Lunge_Pass_Through",
    "Romanian_Deadlift",
    "Kettlebell_One-Legged_Deadlift",
    "One-Arm_Kettlebell_Swings",
    "Band_Good_Morning",
    "Band_Good_Morning_Pull_Through",
    "Barbell_Hip_Thrust",
    "Barbell_Glute_Bridge",
    "Hyperextensions_With_No_Hyperextension_Bench",
    "Glute_Kickback",
    "Monster_Walk",
    "Band_Hip_Adductions",
    "Dumbbell_Seated_One-Leg_Calf_Raise",
    "Calf_Raises_-_With_Bands",
  ],
  core: [
    "Dead_Bug",
    "Side_Bridge",
    "Pallof_Press",
    "Russian_Twist",
    "Reverse_Crunch",
    "Crunches",
    "Flat_Bench_Lying_Leg_Raise",
    "Dumbbell_Side_Bend",
    "Superman",
  ],
  mobility: [
    "Worlds_Greatest_Stretch",
    "Inchworm",
    "Cat_Stretch",
    "Childs_Pose",
    "Kneeling_Hip_Flexor",
    "90_90_Hamstring",
    "Hamstring_Stretch",
    "Quad_Stretch",
    "Calf_Stretch_Hands_Against_Wall",
    "Standing_Soleus_And_Achilles_Stretch",
    "Overhead_Lat",
    "Chest_And_Front_Of_Shoulder_Stretch",
    "Shoulder_Stretch",
    "Triceps_Stretch",
    "Kneeling_Forearm_Stretch",
    "Side_Wrist_Pull",
    "Wrist_Circles",
    "Arm_Circles",
    "Groiners",
    "Adductor",
    "IT_Band_and_Glute_Stretch",
    "Upper_Back_Stretch",
    "Side_Neck_Stretch",
  ],
};

/** Every core exercise id: template exercises first, then substitutes. */
export const CORE_EXERCISES: readonly string[] = [
  ...Object.values(DEFAULT_TEMPLATE_EXERCISES).flat(),
  ...Object.values(substitutes).flat(),
];

const coreIds = new Set(CORE_EXERCISES);

export function isCore(sourceId: string): boolean {
  return coreIds.has(sourceId);
}

/**
 * Output settings and size budget for core images. The whole core set is
 * pre-cached on the phone, so it has to stay small (DECISIONS.md).
 */
export const CORE_IMAGE_BUDGET = {
  width: 480,
  quality: 75,
  maxImageBytes: 40 * 1024,
  maxTotalBytes: 5 * 1024 * 1024,
} as const;

/**
 * Where converted images live. Both folders use the same media paths
 * (`Pushups/0.webp`); core ones are pre-cached on the phone, the rest are
 * fetched when first viewed.
 */
export const MEDIA_DIRS = {
  core: new URL("../media/core/", import.meta.url),
  other: new URL("../media/other/", import.meta.url),
} as const;

/** Path of a converted core image, e.g. `Pushups/0.webp`. */
export function coreMediaFile(path: string): URL {
  return new URL(path, MEDIA_DIRS.core);
}

/** Path of a converted non-core image. */
export function otherMediaFile(path: string): URL {
  return new URL(path, MEDIA_DIRS.other);
}
