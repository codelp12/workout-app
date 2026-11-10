import { localDateAt } from "@workout-app/shared";
import { useEffect, useState } from "react";

/**
 * Today's date in `timezone`, rechecked every minute and when the app comes
 * back to the foreground, so the screen turns over at midnight.
 */
export function useLocalDate(timezone: string | null): string | null {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return timezone === null ? null : localDateAt(timezone, now);
}
