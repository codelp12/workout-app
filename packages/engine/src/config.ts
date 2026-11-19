/**
 * Every engine threshold, in one place (SPEC §5.0). Defaults come from SPEC
 * §5.1–5.3; later tasks let settings override them.
 */
export type EngineConfig = {
  calendar: {
    /** Weeks per block, the last one a deload (SPEC §5.1: 3–6, default 4). */
    blockWeeks: number;
  };
  lift: {
    /** Smoothing weight for a session estimate above the current e1RM (§5.1). */
    alphaUp: number;
    /** Smoothing weight for one below it; larger, so it backs off quicker. */
    alphaDown: number;
    /** Largest rise from one exposure, as a fraction (0.03 is +3%). */
    maxRise: number;
    /** Sets where reps + RIR exceed this don't estimate e1RM. */
    maxRepsPlusRir: number;
    /** Exposures kept per exercise. */
    exposuresKept: number;
    /** How far each exposure closes the gap between confidence and 1. */
    confidenceStep: number;
    /** Cold start (§5.0): days after an exercise's first logged session. */
    calibration: {
      days: number;
      maxRise: number;
      /** Reps short of target that still count as meeting it. */
      missToleranceReps: number;
    };
    /** Progression rules (§5.1 Rules, Increments). */
    progression: {
      /** RIR this far above target counts as beating it. */
      beatRirMargin: number;
      /** Cap on a `double_progression` double increment, as a fraction of load. */
      maxDoubleRise: number;
      /** `double_progression` cut after a second consecutive miss. */
      cut: number;
      /** Stalls that trigger the plateau handler. */
      stallsToPlateau: number;
      /** How long a plateau fix lasts (one default block). */
      plateauDays: number;
      /** Reps the plateau's rep-scheme change shifts the range by. */
      plateauRepShift: number;
      /** A plateau back-off set's load, as a fraction of the working load. */
      backOffLoad: number;
      /** A next step bigger than this fraction of load is too big a jump. */
      maxJump: number;
      /** Reps added to the top of the range per step when the jump is too big. */
      extraRepsStep: number;
      maxExtraReps: number;
      maxExtraSets: number;
    };
  };
  run: {
    /** Share of weekly distance per run when there is no history (§5.2). */
    share: Record<RunWorkoutType, number>;
    targetRpe: Record<RunWorkoutType, Range>;
  };
  climb: {
    /** Hard-attempt cap in a limit session (§5.3). */
    maxHardAttempts: number;
    problems: Record<ClimbWorkoutType, Range>;
  };
};

export type Range = { min: number; max: number };

export const RUN_WORKOUT_TYPES = [
  "easy",
  "threshold",
  "intervals",
  "long",
] as const;
export type RunWorkoutType = (typeof RUN_WORKOUT_TYPES)[number];

export const CLIMB_WORKOUT_TYPES = ["limit", "volume"] as const;
export type ClimbWorkoutType = (typeof CLIMB_WORKOUT_TYPES)[number];

export const ENGINE_CONFIG: EngineConfig = {
  calendar: { blockWeeks: 4 },
  lift: {
    alphaUp: 0.3,
    alphaDown: 0.5,
    maxRise: 0.03,
    maxRepsPlusRir: 12,
    exposuresKept: 6,
    confidenceStep: 0.3,
    calibration: { days: 14, maxRise: 0.015, missToleranceReps: 1 },
    progression: {
      beatRirMargin: 2,
      maxDoubleRise: 0.05,
      cut: 0.075,
      stallsToPlateau: 3,
      plateauDays: 28,
      plateauRepShift: 3,
      backOffLoad: 0.85,
      maxJump: 0.25,
      extraRepsStep: 2,
      maxExtraReps: 4,
      maxExtraSets: 1,
    },
  },
  run: {
    // One long run at 35–45% of the week; easy and quality split the rest.
    share: { easy: 0.3, threshold: 0.3, intervals: 0.3, long: 0.4 },
    targetRpe: {
      easy: { min: 3, max: 4 },
      threshold: { min: 7, max: 7 },
      intervals: { min: 8, max: 8 },
      long: { min: 4, max: 5 },
    },
  },
  climb: {
    maxHardAttempts: 12,
    problems: { limit: { min: 3, max: 5 }, volume: { min: 12, max: 16 } },
  },
};
