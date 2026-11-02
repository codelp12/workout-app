import type { ClimbDiscipline } from "@workout-app/shared";

/**
 * Grades in order, so a grade's index is its numeric value (SPEC §5.3: V0 = 0,
 * V1 = 1 …; a YDS table for routes). Mappings are approximate.
 */
export const GRADE_SCALES: Record<ClimbDiscipline, readonly string[]> = {
  boulder: Array.from({ length: 13 }, (_, i) => `V${i}`),
  route: [
    "5.6",
    "5.7",
    "5.8",
    "5.9",
    ...[10, 11, 12, 13].flatMap((n) =>
      ["a", "b", "c", "d"].map((letter) => `5.${n}${letter}`),
    ),
  ],
};

/** The grade's position on its scale, or `null` if it isn't on it. */
export function gradeIndex(
  discipline: ClimbDiscipline,
  grade: string,
): number | null {
  const index = GRADE_SCALES[discipline].indexOf(grade);
  return index === -1 ? null : index;
}

/** The grade at `index`, clamped to the scale. */
export function gradeAt(discipline: ClimbDiscipline, index: number): string {
  const scale = GRADE_SCALES[discipline];
  const clamped = Math.min(Math.max(Math.round(index), 0), scale.length - 1);
  return scale[clamped] ?? "";
}
