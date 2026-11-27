import {
  ENGINE_CONFIG,
  groupLogs,
  reviewLiftWeek,
  type LiftReview,
} from "@workout-app/engine";
import { addDays, SETTINGS_ID } from "@workout-app/shared";
import { isTimedHold } from "../players/lift-log";
import { localDb } from "../sync";

export type WeeklyLiftReview = LiftReview & {
  timedExerciseIds: string[];
};

export async function readWeeklyLiftReview(
  weekStart: string,
): Promise<WeeklyLiftReview> {
  const tables = [
    localDb.rows("session_log"),
    localDb.rows("set_log"),
    localDb.rows("planned_item"),
    localDb.rows("planned_session"),
    localDb.rows("exercise"),
    localDb.rows("settings"),
  ];
  return localDb.transaction("r", tables, async () => {
    const [sessions, sets, items, plannedSessions, exerciseRows, settings] =
      await Promise.all([
        localDb.rows("session_log").toArray(),
        localDb.rows("set_log").toArray(),
        localDb.rows("planned_item").toArray(),
        localDb.rows("planned_session").toArray(),
        localDb.rows("exercise").toArray(),
        localDb.rows("settings").get(SETTINGS_ID),
      ]);
    const liveSessions = plannedSessions.filter(
      (session) =>
        session.deletedAt === null &&
        session.modality === "lift" &&
        session.status !== "skipped" &&
        session.date >= weekStart &&
        session.date <= addDays(weekStart, 6),
    );
    const sessionById = new Map(
      liveSessions.map((session) => [session.id, session]),
    );
    const liveItems = items.filter((item) => item.deletedAt === null);
    const planned = liveItems.flatMap((item) => {
      const session = sessionById.get(item.plannedSessionId);
      if (item.kind !== "exercise" || item.exerciseId === null || !session) {
        return [];
      }
      return [
        {
          date: session.date,
          exerciseId: item.exerciseId,
          targets: item.targets,
          reasons: item.reasons,
        },
      ];
    });
    const exercises = exerciseRows.filter(
      (exercise) => exercise.deletedAt === null,
    );
    const logs = groupLogs({
      sessions,
      sets,
      runs: [],
      ascents: [],
      items: liveItems,
    });
    const review = reviewLiftWeek({
      weekStart,
      onboarding: settings?.deletedAt === null ? settings.onboarding : null,
      logs: logs.lift,
      exercises: exercises.map(({ id, name, primaryMuscles }) => ({
        id,
        name,
        primaryMuscles,
      })),
      planned,
      config: ENGINE_CONFIG.lift,
    });
    return {
      ...review,
      timedExerciseIds: exercises
        .filter(isTimedHold)
        .map((exercise) => exercise.id),
    };
  });
}
