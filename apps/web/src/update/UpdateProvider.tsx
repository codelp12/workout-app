import { useMemo, useState, type ReactNode } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { UpdateContext, type UpdateStatus } from "./update-context";

// A new service worker waits until the user taps Reload to update in
// Settings, so an update can never interrupt a workout (SPEC §8).
export function UpdateProvider({ children }: { children: ReactNode }) {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const [checkStatus, setCheckStatus] = useState<UpdateStatus>("idle");
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_url, reg) => setRegistration(reg),
  });

  const value = useMemo(() => {
    const status: UpdateStatus = needRefresh
      ? "available"
      : registration
        ? checkStatus
        : "unsupported";

    async function check() {
      if (!registration) return;
      setCheckStatus("checking");
      try {
        await registration.update();
        const incoming = registration.installing;
        if (!incoming) {
          // A build that already finished installing has set needRefresh.
          setCheckStatus("current");
          return;
        }
        // needRefresh turns on once it's installed; this covers a failed install.
        incoming.addEventListener("statechange", () => {
          if (incoming.state === "redundant") setCheckStatus("failed");
        });
      } catch {
        setCheckStatus("failed");
      }
    }

    return {
      status,
      check: () => void check(),
      install: () => void updateServiceWorker(true),
    };
  }, [needRefresh, registration, checkStatus, updateServiceWorker]);

  return (
    <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>
  );
}
