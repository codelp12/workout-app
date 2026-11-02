import type {
  Ascent,
  ClimbDiscipline,
  Onboarding,
  SessionLog,
} from "@workout-app/shared";
import type { ClimbWorkoutType, Range } from "../config.js";
import { gradeAt, gradeIndex } from "../grades.js";
import type { ModalityEngine, Reason } from "../types.js";

export type ClimbIntent = { workoutType: ClimbWorkoutType };

export type ClimbState = {
  discipline: ClimbDiscipline;
  limitGrade: string | null;
  volumeGrade: string | null;
  /** Hardest send of the latest session, if it had one. */
  lastSend: { date: string; grade: string } | null;
};

export type ClimbPrescription = {
  workoutType: ClimbWorkoutType;
  discipline: ClimbDiscipline;
  /** Null when there are no grades to base it on. */
  grades: { min: string; max: string } | null;
  problems: Range;
  /** Limit sessions only. */
  maxHardAttempts: number | null;
  reasons: Reason[];
};

export type ClimbSessionLog = {
  session: Pick<SessionLog, "localDate">;
  ascents: readonly Pick<Ascent, "grade" | "style">[];
};

function initState(onboarding: Onboarding | null): ClimbState {
  const climb = onboarding?.climb;
  return {
    discipline: climb?.discipline ?? "boulder",
    limitGrade: climb?.limitGrade ?? null,
    volumeGrade: climb?.volumeGrade ?? null,
    lastSend: null,
  };
}

function update(state: ClimbState, log: ClimbSessionLog): ClimbState {
  let best: number | null = null;
  for (const ascent of log.ascents) {
    if (ascent.style === "attempt") continue;
    const index = gradeIndex(state.discipline, ascent.grade);
    if (index !== null && (best === null || index > best)) best = index;
  }
  if (best === null) return state;
  if (state.lastSend && state.lastSend.date > log.session.localDate) {
    return state;
  }
  return {
    ...state,
    lastSend: {
      date: log.session.localDate,
      grade: gradeAt(state.discipline, best),
    },
  };
}

/** Phase 1 climbing stub: fixed bands around the setup grades (SPEC §5.3). */
export const climbStub: ModalityEngine<
  ClimbState,
  ClimbIntent,
  ClimbPrescription,
  ClimbSessionLog
> = {
  modality: "climb",
  version: "stub-1",
  initState,
  prescribe: (state, { workoutType }, ctx) => {
    const { discipline } = state;
    const problems = ctx.config.climb.problems[workoutType];
    const maxHardAttempts =
      workoutType === "limit" ? ctx.config.climb.maxHardAttempts : null;
    const grade =
      workoutType === "limit" ? state.limitGrade : state.volumeGrade;
    const index = grade === null ? null : gradeIndex(discipline, grade);
    const reasons: Reason[] = [];
    let grades: ClimbPrescription["grades"] = null;
    if (grade === null || index === null) {
      reasons.push({
        code: "no_history",
        text: `No ${workoutType} grade yet: climb by feel and log your sends.`,
      });
    } else {
      // Limit: limit−1 to limit+1. Volume: volume−2 to volume−1.
      const [low, high] =
        workoutType === "limit"
          ? [index - 1, index + 1]
          : [index - 2, index - 1];
      grades = {
        min: gradeAt(discipline, low),
        max: gradeAt(discipline, high),
      };
      reasons.push({
        code: "from_setup",
        text: `${grades.min}–${grades.max}, around your ${workoutType} grade of ${grade}.`,
      });
    }
    if (maxHardAttempts !== null) {
      reasons.push({
        code: "attempt_cap",
        text: `Stop at ${maxHardAttempts} hard attempts, or sooner if quality drops.`,
      });
    }
    if (state.lastSend) {
      reasons.push({
        code: "last_send",
        text: `Last hardest send: ${state.lastSend.grade} (${state.lastSend.date}).`,
      });
    }
    return {
      workoutType,
      discipline,
      grades,
      problems,
      maxHardAttempts,
      reasons,
    };
  },
  update,
  reviewWeek: (_state, logs) => ({
    reasons: [
      {
        code: "sessions_logged",
        text: `${logs.length} climbing ${logs.length === 1 ? "session" : "sessions"} logged.`,
      },
    ],
  }),
};
