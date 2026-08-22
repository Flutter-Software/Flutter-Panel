import { randomInt } from "node:crypto";
import {
  EMAIL_VERIFY_TTL_MS,
  FlutterError,
  adminUserCreateSchema,
  adminUserUpdateSchema,
  changePasswordSchema,
  loginSchema,
  registerSchema,
  resendVerifySchema,
  verifyEmailSchema,
} from "@flutter-software/shared";
import type { Context } from "hono";
import { User } from "../db/models";
import {
  dummyPasswordHash,
  hashPassword,
  publicUser,
  sha256,
  tokenEquals,
  validatePassword,
  verifyPassword,
} from "./crypto";
import { createSession, destroyOtherSessions, destroySession, getSessionUser } from "./session";
import { resolveSmtp, sendVerificationEmail } from "../mail";
import { attachPendingSubusers } from "../subusers";

export type AuthPayload =
  | { user: ReturnType<typeof publicUser>; needsVerification: false }
  | { user: null; needsVerification: true; email: string };

function requestIp(c: Context) {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    c.req.header("cf-connecting-ip") ||
    "Unknown IP"
  );
}

function isVerified(user: { emailVerified?: boolean | null }) {
  return user.emailVerified !== false;
}

async function requireSmtp() {
  if (await resolveSmtp()) return;
  throw FlutterError.unavailable(
    "Email is not configured. Ask an administrator to set up SMTP before creating an account.",
  );
}

async function issueVerificationCode(
  user: {
    email: string;
    emailVerifyHash?: string | null;
    emailVerifyExpiresAt?: Date | null;
    save: () => Promise<unknown>;
  },
  c: Context,
  options?: { force?: boolean },
) {
  const remaining = (user.emailVerifyExpiresAt?.getTime() ?? 0) - Date.now();
  const recentlyIssued = remaining > EMAIL_VERIFY_TTL_MS - 45_000;
  if (!options?.force && recentlyIssued && user.emailVerifyHash) {
    return;
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  user.emailVerifyHash = sha256(code);
  user.emailVerifyExpiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_MS);
  await user.save();

  const sent = await sendVerificationEmail({
    to: user.email,
    code,
    ip: requestIp(c),
    userAgent: c.req.header("user-agent") ?? undefined,
  });
  if (!sent) {
    throw FlutterError.unavailable(
      "Could not send a verification email. Ask an administrator to configure SMTP.",
    );
  }
}

export async function setupStatus() {
  const userCount = await User.countDocuments();
  return { initialized: userCount > 0, userCount };
}

export async function register(c: Context, body: unknown): Promise<AuthPayload> {
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Invalid registration", parsed.error.flatten());
  }
  const passwordError = validatePassword(parsed.data.password);
  if (passwordError) throw FlutterError.validation(passwordError);

  const setup = await setupStatus();
  const role = setup.initialized ? "user" : "admin";
  const email = parsed.data.email.toLowerCase();

  const existing = await User.findOne({
    $or: [{ username: parsed.data.username }, { email }],
  });
  if (existing) {
    throw FlutterError.conflict("Username or email is already taken");
  }

  if (setup.initialized) {
    await requireSmtp();
  }

  const created = await User.create({
    username: parsed.data.username,
    email,
    passwordHash: await hashPassword(parsed.data.password),
    role,
    emailVerified: !setup.initialized,
    emailVerifyHash: null,
    emailVerifyExpiresAt: null,
  });

  if (!setup.initialized) {
    await createSession(c, created._id.toString(), true);
    await attachPendingSubusers(created);
    return { user: publicUser(created), needsVerification: false };
  }

  try {
    await issueVerificationCode(created, c, { force: true });
  } catch (error) {
    await User.deleteOne({ _id: created._id });
    throw error;
  }

  return { user: null, needsVerification: true, email };
}

export async function login(c: Context, body: unknown): Promise<AuthPayload> {
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Invalid login", parsed.error.flatten());
  }

  const identifier = parsed.data.login.trim();
  const user = await User.findOne({
    $or: [{ username: identifier }, { email: identifier.toLowerCase() }],
  });

  if (!user) {
    await verifyPassword(await dummyPasswordHash(), parsed.data.password);
    throw FlutterError.unauthorized("Invalid login or password");
  }

  const ok = await verifyPassword(user.passwordHash, parsed.data.password);
  if (!ok) {
    throw FlutterError.unauthorized("Invalid login or password");
  }

  if (!isVerified(user)) {
    await issueVerificationCode(user, c);
    return { user: null, needsVerification: true, email: user.email };
  }

  await createSession(c, user._id.toString(), parsed.data.remember);
  await attachPendingSubusers(user);
  return { user: publicUser(user), needsVerification: false };
}

export async function verifyEmail(c: Context, body: unknown): Promise<AuthPayload> {
  const parsed = verifyEmailSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Enter the 6-digit code from your email", parsed.error.flatten());
  }

  const email = parsed.data.email.toLowerCase();
  const user = await User.findOne({ email });
  if (!user || isVerified(user) || !user.emailVerifyHash || !user.emailVerifyExpiresAt) {
    throw FlutterError.validation("Invalid or expired code");
  }
  if (user.emailVerifyExpiresAt.getTime() < Date.now()) {
    throw FlutterError.validation("That code has expired. Request a new one.");
  }
  if (!tokenEquals(user.emailVerifyHash, sha256(parsed.data.code))) {
    throw FlutterError.validation("Invalid or expired code");
  }

  user.emailVerified = true;
  user.emailVerifyHash = null;
  user.emailVerifyExpiresAt = null;
  await user.save();

  await createSession(c, user._id.toString(), true);
  await attachPendingSubusers(user);
  return { user: publicUser(user), needsVerification: false };
}

export async function resendVerification(c: Context, body: unknown) {
  const parsed = resendVerifySchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Enter a valid email", parsed.error.flatten());
  }

  const email = parsed.data.email.toLowerCase();
  const user = await User.findOne({ email });
  if (!user || isVerified(user)) {
    return { ok: true };
  }

  await issueVerificationCode(user, c);
  return { ok: true };
}

export async function logout(c: Context) {
  await destroySession(c);
}

export async function me(c: Context) {
  const session = await getSessionUser(c);
  if (!session) return null;
  const row = await User.findById(session.user.id);
  if (row) await attachPendingSubusers(row);
  return session.user;
}

export async function changePassword(c: Context, body: unknown) {
  const session = await getSessionUser(c);
  if (!session) throw FlutterError.unauthorized();
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Invalid password", parsed.error.flatten());
  }
  const passwordError = validatePassword(parsed.data.password);
  if (passwordError) throw FlutterError.validation(passwordError);
  if (parsed.data.password === parsed.data.currentPassword) {
    throw FlutterError.validation("Choose a different password than the current one");
  }

  const row = await User.findById(session.user.id);
  if (!row) throw FlutterError.unauthorized();
  const ok = await verifyPassword(row.passwordHash, parsed.data.currentPassword);
  if (!ok) throw FlutterError.unauthorized("Current password is incorrect");

  row.passwordHash = await hashPassword(parsed.data.password);
  await row.save();
  await destroyOtherSessions(row._id.toString(), session.sessionId);
  return { ok: true };
}

export async function listUsers() {
  const rows = await User.find().sort({ createdAt: -1 });
  return rows.map(publicUser);
}

export async function createUser(body: unknown) {
  const parsed = adminUserCreateSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Invalid user", parsed.error.flatten());
  }
  const passwordError = validatePassword(parsed.data.password);
  if (passwordError) throw FlutterError.validation(passwordError);

  const email = parsed.data.email.toLowerCase();
  const existing = await User.findOne({
    $or: [{ username: parsed.data.username }, { email }],
  });
  if (existing) {
    throw FlutterError.conflict("Username or email is already taken");
  }

  const created = await User.create({
    username: parsed.data.username,
    email,
    passwordHash: await hashPassword(parsed.data.password),
    role: parsed.data.role,
    emailVerified: true,
  });
  return publicUser(created);
}

export async function getUser(id: string) {
  if (!/^[a-fA-F0-9]{24}$/.test(id)) throw FlutterError.notFound("User not found");
  const row = await User.findById(id);
  if (!row) throw FlutterError.notFound("User not found");
  return publicUser(row);
}

export async function updateUser(id: string, body: unknown, actorId: string) {
  if (!/^[a-fA-F0-9]{24}$/.test(id)) throw FlutterError.notFound("User not found");
  const parsed = adminUserUpdateSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Invalid user", parsed.error.flatten());
  }

  const row = await User.findById(id);
  if (!row) throw FlutterError.notFound("User not found");

  const nextRole = parsed.data.role;
  if (row.role === "admin" && nextRole === "user") {
    if (id === actorId) {
      throw FlutterError.conflict("You cannot remove your own admin role");
    }
    const admins = await User.countDocuments({ role: "admin" });
    if (admins <= 1) {
      throw FlutterError.conflict("Cannot remove the last administrator");
    }
  }

  const email = parsed.data.email.toLowerCase();
  const clash = await User.findOne({
    _id: { $ne: row._id },
    $or: [{ username: parsed.data.username }, { email }],
  });
  if (clash) {
    throw FlutterError.conflict("Username or email is already taken");
  }

  const password = parsed.data.password?.trim() ?? "";
  if (password) {
    const passwordError = validatePassword(password);
    if (passwordError) throw FlutterError.validation(passwordError);
    row.passwordHash = await hashPassword(password);
  }

  row.username = parsed.data.username;
  row.email = email;
  row.role = nextRole;
  await row.save();
  return publicUser(row);
}
