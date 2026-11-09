import { useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Loading, Skeleton } from "../components/Skeleton";
import { modalityStyles } from "../modality";
import {
  formatLongDate,
  readSession,
  type SessionView,
} from "../plan/sessions";
import { ClimbPlayer } from "../players/ClimbPlayer";
import { LiftPlayer } from "../players/LiftPlayer";
import { RunPlayer } from "../players/RunPlayer";
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
      onClick={() =>
        void (location.key === "default" ? navigate("/") : navigate(-1))
      }
    >
      Back
    </button>
  );
}

function Player({ view }: { view: SessionView }) {
  switch (view.session.modality) {
    case "lift":
      return <LiftPlayer view={view} />;
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

/** A planned session, opened from Today's Start button in its modality's player. */
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
      <Player view={view} />
    </Screen>
  );
}
