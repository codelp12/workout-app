import { createHash, randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { Db } from "./db.js";
import { hashPassword, verifyPassword } from "./password.js";
import { account, authSession } from "./schema.js";

const ACCOUNT_ID = 1;
const DAY = 86_400_000;
export const SESSION_COOKIE = "session";
export const SESSION_TTL = 90 * DAY;
export const MAX_FAILED_LOGINS = 5;
export const FAILED_LOGIN_WINDOW = 15 * 60_000;
const PUBLIC_PATHS = new Set(["/api/auth/login"]);

export type AuthOptions = {
  now?: () => number;
  /** Off only for plain-HTTP setups; Tailscale Serve provides HTTPS (SPEC §8). */
  secureCookie?: boolean;
};

const loginBody = z.object({ password: z.string().min(1).max(1024) });

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export function hasPassword(db: Db): boolean {
  return (
    db.select().from(account).where(eq(account.id, ACCOUNT_ID)).get() !==
    undefined
  );
}

/** Sets the owner's password and signs out every session. */
export async function setPassword(db: Db, password: string, now = Date.now()) {
  const passwordHash = await hashPassword(password);
  db.transaction((tx) => {
    tx.insert(account)
      .values({ id: ACCOUNT_ID, passwordHash, updatedAt: now })
      .onConflictDoUpdate({
        target: account.id,
        set: { passwordHash, updatedAt: now },
      })
      .run();
    tx.delete(authSession).run();
  });
}

export function createAuth(
  db: Db,
  { now = Date.now, secureCookie = true }: AuthOptions = {},
) {
  // Single user behind Tailscale Serve, where every request comes from
  // localhost, so failed logins are limited globally rather than per IP.
  const failures: number[] = [];
  function lockedForSeconds(t: number): number {
    while (failures.length > 0 && failures[0]! <= t - FAILED_LOGIN_WINDOW)
      failures.shift();
    if (failures.length < MAX_FAILED_LOGINS) return 0;
    return Math.ceil((failures[0]! + FAILED_LOGIN_WINDOW - t) / 1000);
  }

  function writeCookie(c: Context, token: string) {
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_TTL / 1000,
    });
  }

  // Sessions slide: any authenticated request pushes expiry back to 90 days,
  // at most once a day, so an offline week never signs the owner out.
  const requireSession: MiddlewareHandler = async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path)) return next();
    const token = getCookie(c, SESSION_COOKIE);
    const id = token ? hashToken(token) : null;
    const row = id
      ? db.select().from(authSession).where(eq(authSession.id, id)).get()
      : undefined;
    const t = now();
    if (!token || !row || row.expiresAt <= t)
      return c.json({ error: "Not signed in" }, 401);
    if (row.expiresAt - t < SESSION_TTL - DAY) {
      db.update(authSession)
        .set({ expiresAt: t + SESSION_TTL })
        .where(eq(authSession.id, row.id))
        .run();
      writeCookie(c, token);
    }
    return next();
  };

  const routes = new Hono();

  routes.post("/login", async (c) => {
    const t = now();
    const wait = lockedForSeconds(t);
    if (wait > 0) {
      c.header("Retry-After", String(wait));
      return c.json({ error: "Too many attempts" }, 429);
    }
    const parsed = loginBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
    const row = db
      .select()
      .from(account)
      .where(eq(account.id, ACCOUNT_ID))
      .get();
    const ok =
      row !== undefined &&
      (await verifyPassword(parsed.data.password, row.passwordHash));
    if (!ok) {
      failures.push(t);
      return c.json({ error: "Wrong password" }, 401);
    }
    failures.length = 0;
    const token = randomBytes(32).toString("base64url");
    db.delete(authSession).where(lt(authSession.expiresAt, t)).run();
    db.insert(authSession)
      .values({
        id: hashToken(token),
        createdAt: t,
        expiresAt: t + SESSION_TTL,
      })
      .run();
    writeCookie(c, token);
    return c.json({ ok: true });
  });

  routes.post("/logout", (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token)
      db.delete(authSession)
        .where(eq(authSession.id, hashToken(token)))
        .run();
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: secureCookie });
    return c.json({ ok: true });
  });

  routes.get("/session", (c) => c.json({ signedIn: true }));

  return { requireSession, routes };
}
