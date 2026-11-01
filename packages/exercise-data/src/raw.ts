// The shape of one entry in free-exercise-db's dist/exercises.json
// (its schema.json), checked on load so an upstream change fails loudly.
import { z } from "zod";

export const RAW_CATEGORIES = [
  "strength",
  "stretching",
  "plyometrics",
  "powerlifting",
  "olympic weightlifting",
  "strongman",
  "cardio",
] as const;

export const RAW_EQUIPMENT = [
  "barbell",
  "dumbbell",
  "body only",
  "cable",
  "machine",
  "kettlebells",
  "bands",
  "medicine ball",
  "exercise ball",
  "foam roll",
  "e-z curl bar",
  "other",
] as const;

export const RAW_MUSCLES = [
  "abdominals",
  "abductors",
  "adductors",
  "biceps",
  "calves",
  "chest",
  "forearms",
  "glutes",
  "hamstrings",
  "lats",
  "lower back",
  "middle back",
  "neck",
  "quadriceps",
  "shoulders",
  "traps",
  "triceps",
] as const;

export type RawMuscle = (typeof RAW_MUSCLES)[number];

export const rawExerciseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  force: z.enum(["push", "pull", "static"]).nullable(),
  level: z.enum(["beginner", "intermediate", "expert"]),
  mechanic: z.enum(["compound", "isolation"]).nullable(),
  equipment: z.enum(RAW_EQUIPMENT).nullable(),
  primaryMuscles: z.array(z.enum(RAW_MUSCLES)),
  secondaryMuscles: z.array(z.enum(RAW_MUSCLES)),
  instructions: z.array(z.string()),
  category: z.enum(RAW_CATEGORIES),
  images: z.array(z.string().min(1)),
});
export type RawExercise = z.infer<typeof rawExerciseSchema>;
