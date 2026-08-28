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
  // Installer sets COOKIE_SECURE from APP_URL. Don't infer from the request —
  // behind nginx we always see http://127.0.0.1 even when the public site is https.
  if (env().COOKIE_SECURE !== undefined) return env().COOKIE_SECURE;
  return env().APP_URL.startsWith("https://");
}

function sessionCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "Lax" as const,
    secure: cookieSecure(),
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

function csrfCookieOptions() {
  return {
    path: "/",
    // Readable from JS on purpose — the web client copies this into x-flutter-csrf.
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
  // "Remember me" just doubles the cookie + row TTL. We don't have a separate
  // refresh token; logout deletes this row.
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
  // Unverified users can exist after a crash between insert and the verify
  // email. Treat them as signed-out until they finish /auth/verify.
  if (!user || user.emailVerified === false) return null;
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

export async function listUserSessions(userId: string, currentSessionId: string) {
  const rows = await Session.find({
    userId,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });
  return rows.map((row) => ({
    id: row._id.toString(),
    current: row._id.toString() === currentSessionId,
    ip: row.ip,
    userAgent: row.userAgent,
    // timestamps.createdAt is on new rows; fall back so old session docs still list.
    createdAt: (row as { createdAt?: Date }).createdAt?.toISOString() ?? row.expiresAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}

export async function revokeUserSession(userId: string, sessionId: string, currentSessionId: string) {
  if (sessionId === currentSessionId) {
    throw FlutterError.conflict("You cannot revoke the session you are using. Sign out instead.");
  }
  const result = await Session.deleteOne({ _id: sessionId, userId });
  if (!result.deletedCount) throw FlutterError.notFound("Session not found");
}
