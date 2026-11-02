import { useRegisterSW } from "virtual:pwa-register/react";
import { button, card } from "./ui";

// A new service worker waits until the user taps Reload, so an update can
// never interrupt a workout (SPEC §8).
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      className={`${card} fixed inset-x-4 bottom-[calc(var(--spacing-tab-bar)+max(0.75rem,calc(env(safe-area-inset-bottom)+0.25rem))+1rem)] z-50 mx-auto flex max-w-md items-center gap-2 shadow-lg`}
    >
      <span className="flex-1">Update available.</span>{" "}
      <button
        type="button"
        className={button}
        onClick={() => void updateServiceWorker()}
      >
        Reload
      </button>{" "}
      <button
        type="button"
        className={button}
        onClick={() => setNeedRefresh(false)}
      >
        Later
      </button>
    </div>
  );
}
