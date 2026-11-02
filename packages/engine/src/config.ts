/**
 * Every engine threshold, in one place (SPEC §5.0). Defaults come from SPEC
 * §5.1–5.3; later tasks let settings override them.
 */
export type EngineConfig = {
  calendar: {
    /** Weeks per block, the last one a deload (SPEC §5.1: 3–6, default 4). */
    blockWeeks: number;
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
