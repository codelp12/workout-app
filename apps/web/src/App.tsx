import { useEffect, useState } from "react";
import { checkSession, signOut, type AuthState } from "./auth";
import { SignIn } from "./SignIn";
import { SpikeNotes } from "./SpikeNotes";

export function App() {
  const [auth, setAuth] = useState<AuthState>("checking");

  useEffect(() => {
    const check = () => void checkSession().then(setAuth);
    check();
    window.addEventListener("online", check);
    return () => window.removeEventListener("online", check);
  }, []);

  async function onSignOut() {
    await signOut();
    setAuth("signed-out");
  }

  // Signing in never blocks local writes: notes queue until there's a session.
  return (
    <main>
      <h1>Hello, world</h1>
      {auth === "signed-out" ? (
        <SignIn onSignedIn={() => setAuth("signed-in")} />
      ) : auth === "signed-in" ? (
        <p>
          Signed in{" "}
          <button type="button" onClick={() => void onSignOut()}>
            Sign out
          </button>
        </p>
      ) : (
        <p>{auth === "offline" ? "Offline" : "Checking…"}</p>
      )}
      {/* Remounting on auth changes syncs right after signing in. */}
      <SpikeNotes key={auth} />
    </main>
  );
}
