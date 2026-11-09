import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";
import { checkSession, signOut, type AuthState } from "./auth";
import { Navigation } from "./Navigation";
import { planProvisionalWeek } from "./plan/provisional";
import { onboardingOffered } from "./settings/onboarding-flag";
import { readSettings } from "./settings/settings";
import { SignIn } from "./SignIn";
import { localDb, syncEngine, syncSoon } from "./sync";
import { SyncChip } from "./SyncChip";
import { UnsyncedWarning } from "./UnsyncedData";
import { button } from "./ui";
import { useLiveQuery } from "./use-live-query";

/**
 * Opens the first-run wizard when a fresh install starts on Today. Checked
 * once per launch, after the local settings load; deep links aren't redirected.
 */
function useFirstRunWizard() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const settings = useLiveQuery(readSettings, null);
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current || !settings) return;
    checked.current = true;
    if (pathname === "/" && !settings.onboarding && !onboardingOffered()) {
      void navigate("/onboarding");
    }
  }, [settings, pathname, navigate]);
}

export function App() {
  useFirstRunWizard();
  const [auth, setAuth] = useState<AuthState>("checking");
  const syncState = useSyncExternalStore(
    syncEngine.subscribe,
    syncEngine.getState,
  );
  // A 401 from sync means the session expired since the last check.
  const shownAuth =
    auth === "signed-in" && syncState === "signed-out" ? "signed-out" : auth;

  useEffect(() => {
    const check = () => void checkSession().then(setAuth);
    // Covers a Sunday-night rollover while offline (SPEC §3.2).
    const plan = () =>
      void planProvisionalWeek(localDb).catch((error: unknown) =>
        console.error("Planning the provisional week failed", error),
      );
    check();
    plan();
    syncSoon();
    const onOnline = () => {
      check();
      syncSoon();
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      plan();
      syncSoon();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  async function onSignOut() {
    await signOut();
    setAuth("signed-out");
  }

  // Signing in never blocks local writes: they queue until there's a session.
  return (
    <Navigation
      header={
        <>
          <header className="flex items-center justify-between gap-2">
            <span className="text-lg font-semibold text-fg-muted">Workout</span>
            <SyncChip />
          </header>
          <UnsyncedWarning />
          {shownAuth === "signed-out" ? (
            <SignIn
              onSignedIn={() => {
                setAuth("signed-in");
                syncSoon();
              }}
            />
          ) : shownAuth === "signed-in" ? (
            <p className="flex items-center justify-between text-fg-muted">
              Signed in{" "}
              <button
                type="button"
                className={button}
                onClick={() => void onSignOut()}
              >
                Sign out
              </button>
            </p>
          ) : (
            <p className="text-fg-muted">
              {shownAuth === "offline" ? "Offline" : "Checking…"}
            </p>
          )}
        </>
      }
    />
  );
}
