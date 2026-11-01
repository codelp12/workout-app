import { useState, type FormEvent } from "react";
import { signIn } from "./auth";
import { button, card, input } from "./ui";

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
    <section aria-labelledby="sign-in-heading" className={card}>
      <h2 id="sign-in-heading" className="text-lg font-semibold">
        Sign in
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        Anything you write stays on this device until you sign in.
      </p>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => void onSubmit(e)}
      >
        {/* Lets password managers save the login against a username. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value="owner"
          readOnly
          hidden
        />
        <label className="flex flex-col gap-1 text-sm">
          Password{" "}
          <input
            type="password"
            className={input}
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>{" "}
        <button type="submit" className={button} disabled={busy}>
          Sign in
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
