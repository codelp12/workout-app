import { useCallback, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Loading, Skeleton } from "../components/Skeleton";
import { modalityStyles } from "../modality";
import {
  formatLongDate,
  liftDetail,
  readSession,
  type SessionView,
} from "../plan/sessions";
import { ClimbPlayer } from "../players/ClimbPlayer";
import { LiftPlayer } from "../players/LiftPlayer";
import { markActive, readLiftSession, startLift } from "../players/lift-log";
import { RunPlayer } from "../players/RunPlayer";
import { readSettings } from "../settings/settings";
import { localDb, syncSoon } from "../sync";
import { button, buttonBase, card } from "../ui";
import { useLiveQuery } from "../use-live-query";
import { Screen } from "./Screen";

function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <button
      type="button"
      className={`${button} min-h-tap self-start`}
      onClick={() =>
        void (location.key === "default" ? navigate("/") : navigate(-1))
      }
    >
      Back
    </button>
  );
}

function LiftOverview({ view }: { view: SessionView }) {
  const query = useCallback(() => readLiftSession(localDb, view), [view]);
  const data = useLiveQuery(query, undefined);
  const settings = useLiveQuery(readSettings, null);
  const [starting, setStarting] = useState(false);

  async function start() {
    if (!settings) return;
    setStarting(true);
    try {
      await startLift(localDb, view, settings);
      markActive(view.session.id);
      syncSoon();
    } finally {
      setStarting(false);
    }
  }

  return (
    <section
      aria-label="Workout overview"
      className={`${card} flex flex-col gap-3`}
    >
      <h2 className="text-lg font-semibold">Workout overview</h2>
      {!data ? (
        <Loading label="Loading exercises">
          <Skeleton className="h-12 w-full" />
        </Loading>
      ) : data.cards.length === 0 ? (
        <p className="text-fg-muted">
          Nothing is planned for this session yet.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {data.cards.map(({ itemId, exercise, targets, skipped }) => (
            <li key={itemId} className="flex flex-col">
              <span className="font-medium">
                {exercise?.name ?? "Pick an exercise"}
              </span>
              <span className="text-fg-muted tabular-nums">
                {skipped ? "Skipped" : liftDetail(targets)}
              </span>
            </li>
          ))}
        </ol>
      )}
      <button
        type="button"
        className={`${buttonBase} min-h-tap ${modalityStyles.lift.fill}`}
        disabled={!data || !settings || starting}
        onClick={() => void start()}
      >
        Start workout
      </button>
    </section>
  );
}

function Player({ view }: { view: SessionView }) {
  switch (view.session.modality) {
    case "lift":
      return view.session.status === "planned" && !view.inProgress ? (
        <LiftOverview view={view} />
      ) : (
        <LiftPlayer view={view} />
      );
    case "run":
      return <RunPlayer view={view} />;
    case "climb":
      return <ClimbPlayer view={view} />;
    default:
      return (
        <p className={`${card} text-fg-muted`}>
          There&apos;s no player for this session yet.
        </p>
      );
  }
}

/** A planned session's preview or player. */
export function Session() {
  const { id = "" } = useParams();
  const query = useCallback(() => readSession(id), [id]);
  const view = useLiveQuery<SessionView | null | undefined>(query, undefined);

  if (view === undefined)
    return (
      <Screen title="Session">
        <Loading label="Loading session">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </Loading>
      </Screen>
    );
  if (view === null)
    return (
      <Screen title="Session not found">
        <BackButton />
        <p className={`${card} text-fg-muted`}>
          This session isn&apos;t in the plan any more.
        </p>
      </Screen>
    );

  const { session } = view;
  const style = modalityStyles[session.modality];
  return (
    <Screen title={view.title}>
      <BackButton />
      <p className="flex flex-wrap gap-x-2 text-fg-muted">
        <span className={`font-medium ${style.text}`}>{style.label}</span>
        <span>
          {formatLongDate(session.date)}, {session.slot.toUpperCase()}
        </span>
      </p>
      <Player key={session.id} view={view} />
    </Screen>
  );
}
