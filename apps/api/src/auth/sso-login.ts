import {
  FlutterError,
  SSO_LOGIN_TTL_MS,
  SSO_LOGIN_TOKEN_PREFIX,
  ssoLoginCreateSchema,
} from "@flutter-software/shared";
import type { Context } from "hono";
import { SsoLoginToken, User } from "../db/models";
import { env } from "../env";
import { attachPendingSubusers } from "../subusers";
import { publicUser, randomToken, sha256 } from "./crypto";
import { createSession, destroySession } from "./session";

function appOrigin() {
  return env().APP_URL.replace(/\/+$/, "");
}

function loginErrorUrl() {
  return `${appOrigin()}/login?error=sso`;
}

function safeNext(value: string | undefined | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw FlutterError.validation("Invalid JSON");
  }
}

export async function mintSsoLogin(body: unknown) {
  const parsed = ssoLoginCreateSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("userId, email, or username is required", parsed.error.flatten());
  }

  const user = parsed.data.userId
    ? await User.findById(parsed.data.userId)
    : parsed.data.email
      ? await User.findOne({ email: parsed.data.email.toLowerCase() })
      : await User.findOne({ username: parsed.data.username });
  if (!user) throw FlutterError.notFound("User not found");

  const userId = user._id.toString();
  await SsoLoginToken.deleteMany({ userId, usedAt: null });

  const token = `${SSO_LOGIN_TOKEN_PREFIX}${randomToken(32)}`;
  const expiresAt = new Date(Date.now() + SSO_LOGIN_TTL_MS);
  await SsoLoginToken.create({
    userId,
    tokenHash: sha256(token),
    next: safeNext(parsed.data.next),
    expiresAt,
  });

  return {
    token,
    url: `${appOrigin()}/sso?token=${encodeURIComponent(token)}`,
    expiresAt: expiresAt.toISOString(),
    user: publicUser(user),
  };
}

export async function mintSsoLoginFromRequest(c: Context, userId?: string) {
  const body = await readJson(c);
  const extra = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  return mintSsoLogin(userId ? { ...extra, userId } : extra);
}

export async function consumeSsoLogin(c: Context) {
  const token = (c.req.query("token") ?? "").trim();
  if (!token.startsWith(SSO_LOGIN_TOKEN_PREFIX)) {
    return c.redirect(loginErrorUrl());
  }

  const row = await SsoLoginToken.findOneAndUpdate(
    { tokenHash: sha256(token), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
  );
  if (!row) return c.redirect(loginErrorUrl());

  const user = await User.findById(row.userId);
  if (!user) return c.redirect(loginErrorUrl());
  if (user.emailVerified === false) {
    user.emailVerified = true;
    await user.save();
  }

  await destroySession(c);
  await createSession(c, user._id.toString(), true);
  await attachPendingSubusers(user);
  return c.redirect(`${appOrigin()}${safeNext(row.next)}`);
}
