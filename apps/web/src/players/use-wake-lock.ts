import { useEffect } from "react";

/**
 * Keeps the screen on while `active` (SPEC §3.4). The browser drops the lock
 * whenever the app is hidden, so it's taken again on return. Without the
 * API, or if it's refused (low-power mode), the screen just locks as usual.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let pending = false;
    let stopped = false;

    const acquire = async () => {
      if (pending || document.visibilityState !== "visible") return;
      if (sentinel && !sentinel.released) return;
      pending = true;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (stopped) void lock.release();
        else sentinel = lock;
      } catch {
        // Refused: nothing to do but let the screen lock.
      } finally {
        pending = false;
      }
    };

    const onVisibility = () => void acquire();
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (sentinel && !sentinel.released) void sentinel.release();
    };
  }, [active]);
}
