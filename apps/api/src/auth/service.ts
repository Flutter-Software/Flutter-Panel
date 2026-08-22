import { FlutterError, adminUserCreateSchema, adminUserUpdateSchema, changePasswordSchema, loginSchema, registerSchema } from "@flutter-software/shared";
import type { Context } from "hono";
import { User } from "../db/models";
import {
  dummyPasswordHash,
  hashPassword,
  publicUser,
  validatePassword,
  verifyPassword,
} from "./crypto";
import { createSession, destroyOtherSessions, destroySession, getSessionUser } from "./session";
import { attachPendingSubusers } from "../subusers";

export async function setupStatus() {
  const userCount = await User.countDocuments();
  return { initialized: userCount > 0, userCount };
}

export async function register(c: Context, body: unknown) {
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

  const created = await User.create({
    username: parsed.data.username,
    email,
    passwordHash: await hashPassword(parsed.data.password),
    role,
  });

  await createSession(c, created._id.toString(), true);
  await attachPendingSubusers(created);
  return publicUser(created);
}

export async function login(c: Context, body: unknown) {
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

  await createSession(c, user._id.toString(), parsed.data.remember);
  await attachPendingSubusers(user);
  return publicUser(user);
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
