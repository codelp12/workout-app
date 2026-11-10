import { useEffect, useState } from "react";
import { playRestCue } from "./rest-cue";
import {
  formatClock,
  REST_OVERTIME_SHOWN_MS,
  secondsLeft,
  type Rest,
} from "./rest";

// The beep only plays if the rest ran out this recently, so coming back to
// the app long after it ended (or reopening it after a kill) stays quiet.
const CUE_WINDOW_MS = 2000;

/**
 * Counts down the rest after the latest set. The time left is worked out from
 * the set's timestamp on every tick and whenever the app comes back to the
 * foreground, so a locked screen or a kill can't put it out (SPEC §3.4).
 */
export function RestTimer({ rest }: { rest: Rest }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [rest.endsAt]);

  const left = secondsLeft(rest, now);
  const over = left <= 0;
  useEffect(() => {
    if (!over) return;
    const late = Date.now() - rest.endsAt;
    if (document.visibilityState === "visible" && late < CUE_WINDOW_MS) {
      playRestCue();
    }
  }, [over, rest.endsAt]);

  if (now - rest.endsAt > REST_OVERTIME_SHOWN_MS) return null;
  return (
    <section
      aria-label="Rest timer"
      className={`flex min-h-16 items-center justify-between gap-3 rounded-xl p-4 tabular-nums ${
        over ? "bg-lift text-bg" : "bg-surface"
      }`}
    >
      {over ? (
        <>
          <p role="status" className="text-lg font-semibold">
            Rest over
          </p>
          <span>+{formatClock(Math.floor((now - rest.endsAt) / 1000))}</span>
        </>
      ) : (
        <>
          <span className="text-fg-muted">Rest</span>
          <span className="flex-1">
            <span className="block h-1.5 overflow-hidden rounded-full bg-surface-raised">
              <span
                className="block h-full bg-lift"
                style={{ width: `${(left / rest.restSec) * 100}%` }}
              />
            </span>
          </span>
          <span role="timer" className="text-2xl font-semibold">
            {formatClock(left)}
          </span>
        </>
      )}
    </section>
  );
}
