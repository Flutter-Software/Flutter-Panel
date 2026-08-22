import {
  CSRF_COOKIE,
  CSRF_HEADER,
  CSRF_TTL_MS,
  FlutterError,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "@flutter-software/shared";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Session, User } from "../db/models";
import { env } from "../env";
import { publicUser, randomToken, sha256 } from "./crypto";

function cookieSecure() {
  if (env().COOKIE_SECURE !== undefined) return env().COOKIE_SECURE;
  return env().APP_URL.startsWith("https://");
}

export function sessionCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "Lax" as const,
    secure: cookieSecure(),
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

export function csrfCookieOptions() {
  return {
    path: "/",
    httpOnly: false,
    sameSite: "Lax" as const,
    secure: cookieSecure(),
    maxAge: Math.floor(CSRF_TTL_MS / 1000),
  };
}

export function ensureCsrfCookie(c: Context) {
  if (!getCookie(c, CSRF_COOKIE)) {
    setCookie(c, CSRF_COOKIE, randomToken(24), csrfCookieOptions());
  }
}

export function assertCsrf(c: Context) {
  const cookie = getCookie(c, CSRF_COOKIE) ?? "";
  const header = c.req.header(CSRF_HEADER) ?? "";
  if (!cookie || !header || cookie !== header) {
    throw FlutterError.forbidden("CSRF token mismatch");
  }
}

export async function createSession(
  c: Context,
  userId: string,
  remember?: boolean,
) {
  const token = randomToken();
  const ttl = remember ? SESSION_TTL_MS * 2 : SESSION_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);
  await Session.create({
    userId,
    tokenHash: sha256(token),
    expiresAt,
    userAgent: c.req.header("user-agent") ?? null,
    ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });
  setCookie(c, SESSION_COOKIE, token, {
    ...sessionCookieOptions(),
    maxAge: Math.floor(ttl / 1000),
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function getSessionUser(c: Context) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const session = await Session.findOne({
    tokenHash: sha256(token),
    expiresAt: { $gt: new Date() },
  });
  if (!session) return null;
  const user = await User.findById(session.userId);
  if (!user) return null;
  return { user: publicUser(user), sessionId: session._id.toString() };
}

export async function destroySession(c: Context) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await Session.deleteOne({ tokenHash: sha256(token) });
  }
  clearSessionCookie(c);
}

export async function requireUser(c: Context) {
  const session = await getSessionUser(c);
  if (!session) throw FlutterError.unauthorized();
  return session;
}

export async function requireAdmin(c: Context) {
  const session = await requireUser(c);
  if (session.user.role !== "admin") throw FlutterError.forbidden();
  return session;
}

export async function destroyOtherSessions(userId: string, keepSessionId: string) {
  await Session.deleteMany({ userId, _id: { $ne: keepSessionId } });
}
