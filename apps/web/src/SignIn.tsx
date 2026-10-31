import { useState, type FormEvent } from "react";
import { signIn } from "./auth";

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await signIn(password);
    setBusy(false);
    if (result.ok) {
      setPassword("");
      onSignedIn();
    } else {
      setError(result.error);
    }
  }

  return (
    <section aria-labelledby="sign-in-heading">
      <h2 id="sign-in-heading">Sign in</h2>
      <p>Anything you write stays on this device until you sign in.</p>
      <form onSubmit={(e) => void onSubmit(e)}>
        {/* Lets password managers save the login against a username. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value="owner"
          readOnly
          hidden
        />
        <label>
          Password{" "}
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>{" "}
        <button type="submit" disabled={busy}>
          Sign in
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
