import { useRegisterSW } from "virtual:pwa-register/react";

// A new service worker waits until the user taps Reload, so an update can
// never interrupt a workout (SPEC §8).
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div role="status">
      <span>Update available.</span>{" "}
      <button type="button" onClick={() => void updateServiceWorker()}>
        Reload
      </button>{" "}
      <button type="button" onClick={() => setNeedRefresh(false)}>
        Later
      </button>
    </div>
  );
}
