export type AuthState = "checking" | "signed-in" | "signed-out" | "offline";

export async function checkSession(): Promise<Exclude<AuthState, "checking">> {
  try {
    const res = await fetch("/api/auth/session");
    if (res.ok) return "signed-in";
    return res.status === 401 ? "signed-out" : "offline";
  } catch {
    return "offline";
  }
}

export type SignInResult = { ok: true } | { ok: false; error: string };

export async function signIn(password: string): Promise<SignInResult> {
  let res: Response;
  try {
    res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
  } catch {
    return { ok: false, error: "Can't reach the server." };
  }
  if (res.ok) return { ok: true };
  if (res.status === 401) return { ok: false, error: "Wrong password." };
  if (res.status === 429) {
    const minutes = Math.ceil(
      Number(res.headers.get("retry-after") ?? 60) / 60,
    );
    return {
      ok: false,
      error: `Too many attempts. Try again in ${minutes} min.`,
    };
  }
  return { ok: false, error: "Sign-in failed." };
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
}
