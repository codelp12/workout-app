import { useEffect, useState, useSyncExternalStore } from "react";
import { checkSession, signOut, type AuthState } from "./auth";
import { Projects } from "./Projects";
import { SignIn } from "./SignIn";
import { syncEngine, syncSoon } from "./sync";
import { SyncChip } from "./SyncChip";
import { ImportUnsynced, UnsyncedWarning } from "./UnsyncedData";
import { button } from "./ui";

export function App() {
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
    check();
    syncSoon();
    const onOnline = () => {
      check();
      syncSoon();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") syncSoon();
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
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Workout</h1>
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
      <Projects />
      <ImportUnsynced />
    </main>
  );
}
