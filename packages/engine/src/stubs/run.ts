import type { Onboarding, RunLog, SessionLog } from "@workout-app/shared";
import type { Range, RunWorkoutType } from "../config.js";
import { RUN_WORKOUT_TYPES } from "../config.js";
import type { ModalityEngine, Reason } from "../types.js";
import { formatAmount, toDistanceUnit, type Distance } from "../units.js";

export type RunIntent = { workoutType: RunWorkoutType };

export type RunExposure = {
  date: string;
  distance: Distance;
  durationSec: number | null;
};

export type RunState = {
  /** Typical weekly volume from onboarding. */
  weeklyDistance: Distance | null;
  /** The latest run of each type. */
  last: Partial<Record<RunWorkoutType, RunExposure>>;
};

export type RunPrescription = {
  workoutType: RunWorkoutType;
  /** In the context's distance unit; null when there's nothing to base it on. */
  distance: Distance | null;
  targetRpe: Range;
  reasons: Reason[];
};

export type RunSessionLog = {
  session: Pick<SessionLog, "localDate">;
  run: Pick<
    RunLog,
    "workoutType" | "distanceValue" | "distanceUnit" | "durationSec"
  >;
};

const isRunWorkoutType = (type: string): type is RunWorkoutType =>
  (RUN_WORKOUT_TYPES as readonly string[]).includes(type);

const tenth = (value: number) => Math.round(value * 10) / 10;

function initState(onboarding: Onboarding | null): RunState {
  const run = onboarding?.run;
  return {
    weeklyDistance: run
      ? { value: run.weeklyDistance, unit: run.distanceUnit }
      : null,
    last: {},
  };
}

function update(state: RunState, { session, run }: RunSessionLog): RunState {
  const type = run.workoutType;
  if (!isRunWorkoutType(type) || run.distanceValue === null) return state;
  const previous = state.last[type];
  if (previous && previous.date > session.localDate) return state;
  return {
    ...state,
    last: {
      ...state.last,
      [type]: {
        date: session.localDate,
        distance: { value: run.distanceValue, unit: run.distanceUnit },
        durationSec: run.durationSec,
      },
    },
  };
}

/** Phase 1 running stub: last time's distance, or a share of the usual week. */
export const runStub: ModalityEngine<
  RunState,
  RunIntent,
  RunPrescription,
  RunSessionLog
> = {
  modality: "run",
  version: "stub-1",
  initState,
  prescribe: (state, { workoutType }, ctx) => {
    const unit = ctx.distanceUnit;
    const targetRpe = ctx.config.run.targetRpe[workoutType];
    const rpeReason: Reason = {
      code: "target_rpe",
      text: `Aim for RPE ${targetRpe.min === targetRpe.max ? targetRpe.min : `${targetRpe.min}–${targetRpe.max}`}; paces arrive with the running engine.`,
    };
    const last = state.last[workoutType];
    if (last) {
      const value = tenth(toDistanceUnit(last.distance, unit));
      return {
        workoutType,
        distance: { value, unit },
        targetRpe,
        reasons: [
          {
            code: "repeat_last",
            text: `Same distance as your last ${workoutType} run (${last.date}): ${formatAmount(value, unit)}.`,
          },
          rpeReason,
        ],
      };
    }
    if (state.weeklyDistance && state.weeklyDistance.value > 0) {
      const share = ctx.config.run.share[workoutType];
      const weekly = toDistanceUnit(state.weeklyDistance, unit);
      const value = tenth(weekly * share);
      return {
        workoutType,
        distance: { value, unit },
        targetRpe,
        reasons: [
          {
            code: "from_setup",
            text: `${Math.round(share * 100)}% of the ${formatAmount(tenth(weekly), unit)} week from your setup answers.`,
          },
          rpeReason,
        ],
      };
    }
    return {
      workoutType,
      distance: null,
      targetRpe,
      reasons: [
        {
          code: "no_history",
          text: "No running history yet: run by feel.",
        },
        rpeReason,
      ],
    };
  },
  update,
  reviewWeek: (_state, logs) => ({
    reasons: [
      {
        code: "sessions_logged",
        text: `${logs.length} ${logs.length === 1 ? "run" : "runs"} logged.`,
      },
    ],
  }),
};
