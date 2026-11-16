import { useCallback, useId } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Loading, Skeleton } from "../components/Skeleton";
import {
  readHistoryDetail,
  sessionFacts,
  type HistoryDetail,
  type LoggedExercise,
} from "../history/history";
import { modalityStyles } from "../modality";
import { formatLongDate } from "../plan/sessions";
import { describeAscent, disciplineOf, plural } from "../players/climb-log";
import { Pyramid } from "../players/ClimbPlayer";
import { describeSet } from "../players/lift-log";
import { runFacts } from "../players/run-log";
import { Splits } from "../players/RunPlayer";
import { localDb } from "../sync";
import { button, card } from "../ui";
import { useLiveQuery } from "../use-live-query";
import { Screen } from "./Screen";

function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <button
      type="button"
      className={`${button} min-h-tap self-start`}
      // Back keeps the Log's filter; a deep link has no history.
      onClick={() =>
        void (location.key === "default" ? navigate("/log") : navigate(-1))
      }
    >
      Back
    </button>
  );
}

function ExerciseSets({ exercise }: { exercise: LoggedExercise }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`${card} flex flex-col gap-2`}>
      <h2 id={id} className="font-semibold">
        {exercise.name}
      </h2>
      {exercise.warmups.length > 0 && (
        <p className="text-fg-muted">
          {plural(exercise.warmups.length, "warm-up set")}
        </p>
      )}
      {exercise.sets.length > 0 && (
        <ol aria-label="Sets" className="flex flex-col gap-1 tabular-nums">
          {exercise.sets.map((set) => (
            <li key={set.id} className="flex justify-between">
              <span className="text-fg-muted">Set {set.index + 1}</span>
              <span>{describeSet(set)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function LiftDetail({ detail }: { detail: HistoryDetail }) {
  if (detail.exercises.length === 0) {
    return <p className={`${card} text-fg-muted`}>No sets logged.</p>;
  }
  return detail.exercises.map((exercise) => (
    <ExerciseSets key={exercise.exerciseId} exercise={exercise} />
  ));
}

function RunDetail({ detail }: { detail: HistoryDetail }) {
  const { run } = detail;
  if (!run) return <p className={`${card} text-fg-muted`}>No run logged.</p>;
  const { facts, extras } = runFacts(run);
  return (
    <section aria-label="Run" className={`${card} flex flex-col gap-2`}>
      <p className="tabular-nums">{facts.slice(1).join(" · ")}</p>
      {extras.length > 0 && (
        <p className="tabular-nums text-fg-muted">{extras.join(" · ")}</p>
      )}
      <Splits run={run} />
    </section>
  );
}

function ClimbDetail({ detail }: { detail: HistoryDetail }) {
  const { ascents, projectNames } = detail;
  if (ascents.length === 0) {
    return <p className={`${card} text-fg-muted`}>No climbs logged.</p>;
  }
  // One pyramid per grade scale, so V-scale and YDS grades never mix.
  const disciplines = [
    ...new Set(ascents.flatMap((a) => disciplineOf(a.grade) ?? [])),
  ].sort();
  return (
    <>
      {disciplines.map((discipline) => (
        <Pyramid
          key={discipline}
          ascents={ascents.filter((a) => disciplineOf(a.grade) === discipline)}
          discipline={discipline}
        />
      ))}
      <section aria-label="Climbs" className={`${card} flex flex-col gap-2`}>
        <h2 className="font-semibold">Climbs</h2>
        <ol className="flex flex-col gap-1 tabular-nums">
          {ascents.map((ascent) => (
            <li key={ascent.id}>
              {describeAscent(
                ascent,
                (ascent.projectId && projectNames.get(ascent.projectId)) ||
                  null,
              )}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function Detail({ detail }: { detail: HistoryDetail }) {
  switch (detail.log.modality) {
    case "run":
      return <RunDetail detail={detail} />;
    case "climb":
      return <ClimbDetail detail={detail} />;
    default:
      return <LiftDetail detail={detail} />;
  }
}

/** A past session from the Log: what was logged, read-only. */
export function LoggedSession() {
  const { id = "" } = useParams();
  const query = useCallback(() => readHistoryDetail(localDb, id), [id]);
  const detail = useLiveQuery<HistoryDetail | null | undefined>(
    query,
    undefined,
  );

  if (detail === undefined)
    return (
      <Screen title="Session">
        <Loading label="Loading session">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </Loading>
      </Screen>
    );
  if (detail === null)
    return (
      <Screen title="Session not found">
        <BackButton />
        <p className={`${card} text-fg-muted`}>
          This session isn&apos;t in your log any more.
        </p>
      </Screen>
    );

  const { log } = detail;
  const style = modalityStyles[log.modality];
  return (
    <Screen title={detail.title}>
      <BackButton />
      <p className="flex flex-wrap gap-x-2 text-fg-muted">
        <span className={`font-medium ${style.text}`}>{style.label}</span>
        <span>{formatLongDate(log.localDate)}</span>
      </p>
      <section
        aria-label="Summary"
        className={`${card} ${style.accent} flex flex-col gap-1`}
      >
        <p className="tabular-nums">{sessionFacts(log)}</p>
        {log.notes && <p className="whitespace-pre-wrap">{log.notes}</p>}
      </section>
      <Detail detail={detail} />
    </Screen>
  );
}
