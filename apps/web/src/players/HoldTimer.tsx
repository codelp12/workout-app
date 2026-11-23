import { useEffect, useState } from "react";
import { button } from "../ui";
import { formatClock, holdSeconds } from "./rest";

function HoldClock({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  return (
    <span role="timer" className="text-xl font-semibold tabular-nums">
      {formatClock(holdSeconds(startedAt, now))}
    </span>
  );
}

export function HoldTimer({
  startedAt,
  onStart,
  onStop,
  disabled,
}: {
  startedAt: number | null;
  onStart: () => void;
  onStop: () => void;
  disabled: boolean;
}) {
  return (
    <section
      aria-label="Hold timer"
      className="flex items-center justify-between gap-3"
    >
      {startedAt === null ? (
        <span className="text-fg-muted">Hold timer</span>
      ) : (
        <HoldClock startedAt={startedAt} />
      )}
      <button
        type="button"
        className={`${button} min-h-tap`}
        disabled={disabled}
        onClick={startedAt === null ? onStart : onStop}
      >
        {startedAt === null ? "Start hold" : "Stop hold"}
      </button>
    </section>
  );
}
