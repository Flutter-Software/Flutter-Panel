import { randomInt } from "node:crypto";
import {
  EMAIL_VERIFY_TTL_MS,
  FlutterError,
  adminUserCreateSchema,
  adminUserUpdateSchema,
  changePasswordSchema,
  updateProfileSchema,
  loginSchema,
  registerSchema,
  resendVerifySchema,
  totpDisableSchema,
  totpEnableSchema,
  totpLoginSchema,
  totpSetupSchema,
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
import {
  createSession,
  destroyOtherSessions,
  destroySession,
  getAuth,
  getSessionUser,
  listUserSessions,
  revokeUserSession,
} from "./session";
import { resolveSmtp, sendVerificationEmail } from "../mail";
import { attachPendingSubusers } from "../subusers";
import { env } from "../env";
import { getSiteName } from "../settings";
import {
  generateTotpSecret,
  otpauthUrl,
  signTotpChallenge,
  totpQrDataUrl,
  verifyTotpChallenge,
  verifyTotpCode,
} from "./totp";

export type AuthPayload =
  | { user: ReturnType<typeof publicUser>; needsVerification: false; needsTotp?: false }
  | { user: null; needsVerification: true; email: string }
  | { user: null; needsVerification: false; needsTotp: true; totpToken: string };

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
  // Don't burn SMTP on refresh-spam. 45s is "they clicked resend immediately".
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
  // Empty panel → first account is the admin, no email required. After that we
  // refuse to create users if SMTP isn't up so we don't leave orphan rows.
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
    // Same argon2 work as a real password check so usernames aren't enumerable
    // from response timing.
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

  if (user.totpEnabled) {
    if (!user.totpSecret) {
      throw FlutterError.unauthorized("Two-factor authentication is misconfigured for this account");
    }
    // Don't create a session yet. The signed totpToken is a 5-minute ticket
    // that only proves they already passed the password step.
    return {
      user: null,
      needsVerification: false,
      needsTotp: true,
      totpToken: signTotpChallenge(env().SESSION_SECRET, {
        userId: user._id.toString(),
        remember: parsed.data.remember,
      }),
    };
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
  const auth = await getAuth(c);
  if (!auth) return null;
  const row = await User.findById(auth.user.id);
  if (row) await attachPendingSubusers(row);
  return auth.user;
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
  // Keep this browser's cookie; everything else is dead after a password change.
  await destroyOtherSessions(row._id.toString(), session.sessionId);
  return { ok: true };
}

export async function updateProfile(c: Context, body: unknown) {
  const session = await getSessionUser(c);
  if (!session) throw FlutterError.unauthorized();
  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Invalid profile", parsed.error.flatten());
  }

  const row = await User.findById(session.user.id);
  if (!row) throw FlutterError.unauthorized();

  const email = parsed.data.email.toLowerCase();
  const clash = await User.findOne({
    _id: { $ne: row._id },
    $or: [{ username: parsed.data.username }, { email }],
  });
  if (clash) {
    throw FlutterError.conflict("Username or email is already taken");
  }

  row.username = parsed.data.username;
  row.email = email;
  await row.save();
  return { user: publicUser(row) };
}

export async function listSessions(c: Context) {
  const session = await getSessionUser(c);
  if (!session) throw FlutterError.unauthorized();
  return { sessions: await listUserSessions(session.user.id, session.sessionId) };
}

export async function revokeSession(c: Context, sessionId: string) {
  const session = await getSessionUser(c);
  if (!session) throw FlutterError.unauthorized();
  await revokeUserSession(session.user.id, sessionId, session.sessionId);
  return { ok: true };
}

export async function loginWithTotp(c: Context, body: unknown): Promise<AuthPayload> {
  const parsed = totpLoginSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Enter the 6-digit authenticator code", parsed.error.flatten());
  }
  const challenge = verifyTotpChallenge(env().SESSION_SECRET, parsed.data.token);
  if (!challenge) {
    throw FlutterError.unauthorized("That sign-in code expired. Sign in again.");
  }
  const user = await User.findById(challenge.userId);
  if (!user?.totpEnabled || !user.totpSecret) {
    throw FlutterError.unauthorized("Two-factor authentication is not enabled");
  }
  if (!verifyTotpCode(user.totpSecret, parsed.data.code)) {
    throw FlutterError.unauthorized("Invalid authenticator code");
  }
  await createSession(c, user._id.toString(), challenge.remember);
  await attachPendingSubusers(user);
  return { user: publicUser(user), needsVerification: false };
}

async function requirePassword(user: { passwordHash: string }, password: string, message: string) {
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) throw FlutterError.unauthorized(message);
}

export async function setupTotp(c: Context, body: unknown) {
  const session = await getSessionUser(c);
  if (!session) throw FlutterError.unauthorized();
  const parsed = totpSetupSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Enter your current password", parsed.error.flatten());
  }

  const row = await User.findById(session.user.id);
  if (!row) throw FlutterError.unauthorized();
  await requirePassword(row, parsed.data.password, "Current password is incorrect");
  if (row.totpEnabled) {
    throw FlutterError.conflict("Two-factor authentication is already enabled");
  }

  const secret = generateTotpSecret();
  // Persist before we show the QR so a refresh doesn't mint a second secret
  // the authenticator never saw. totpEnabled stays false until /enable.
  row.totpSecret = secret;
  row.totpEnabled = false;
  await row.save();

  const issuer = await getSiteName();
  const otpauth = otpauthUrl({ issuer, account: row.email, secret });
  return {
    secret,
    otpauth,
    qrDataUrl: await totpQrDataUrl(otpauth),
  };
}

export async function enableTotp(c: Context, body: unknown) {
  const session = await getSessionUser(c);
  if (!session) throw FlutterError.unauthorized();
  const parsed = totpEnableSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Enter the 6-digit authenticator code", parsed.error.flatten());
  }

  const row = await User.findById(session.user.id);
  if (!row) throw FlutterError.unauthorized();
  if (row.totpEnabled) {
    throw FlutterError.conflict("Two-factor authentication is already enabled");
  }
  if (!row.totpSecret || !verifyTotpCode(row.totpSecret, parsed.data.code)) {
    throw FlutterError.validation("Invalid authenticator code");
  }

  row.totpEnabled = true;
  await row.save();
  return { user: publicUser(row) };
}

export async function disableTotp(c: Context, body: unknown) {
  const session = await getSessionUser(c);
  if (!session) throw FlutterError.unauthorized();
  const parsed = totpDisableSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Password and authenticator code are required", parsed.error.flatten());
  }

  const row = await User.findById(session.user.id);
  if (!row) throw FlutterError.unauthorized();
  await requirePassword(row, parsed.data.password, "Current password is incorrect");
  if (!row.totpEnabled || !row.totpSecret) {
    throw FlutterError.conflict("Two-factor authentication is not enabled");
  }
  if (!verifyTotpCode(row.totpSecret, parsed.data.code)) {
    throw FlutterError.validation("Invalid authenticator code");
  }

  row.totpEnabled = false;
  row.totpSecret = null;
  await row.save();
  return { user: publicUser(row) };
}

export async function cancelTotpSetup(c: Context) {
  const session = await getSessionUser(c);
  if (!session) throw FlutterError.unauthorized();
  const row = await User.findById(session.user.id);
  if (!row) throw FlutterError.unauthorized();
  if (row.totpEnabled) {
    throw FlutterError.conflict("Two-factor authentication is already enabled");
  }
  row.totpSecret = null;
  await row.save();
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
