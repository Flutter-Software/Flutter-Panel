import {
  FlutterError,
  INVITE_TTL_MS,
  NAV_PERMISSION,
  hasServerPermission,
  inviteCompleteSchema,
  normalizePermissions,
  subuserUpdateSchema,
  subuserUpsertSchema,
  type ServerPermission,
} from "@flutter-software/shared";
import type { Context } from "hono";
import { Allocation, Node, Server, Subuser, User } from "./db/models";
import { env } from "./env";
import { sendSubuserInvite } from "./mail";
import { hashPassword, publicUser, randomToken, sha256, validatePassword } from "./auth/crypto";
import { createSession } from "./auth/session";
import { assertPerm, requireAccess } from "./servers";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inviteUrl(token: string) {
  return `${env().APP_URL.replace(/\/+$/, "")}/invite/${encodeURIComponent(token)}`;
}

async function inviteMailContext(server: {
  name: string;
  status?: string;
  nodeId: unknown;
  allocationId: unknown;
}) {
  const [node, allocation] = await Promise.all([
    Node.findById(server.nodeId),
    Allocation.findById(server.allocationId),
  ]);
  const host = (typeof allocation?.alias === "string" && allocation.alias.trim()) || allocation?.ip || "";
  return {
    serverName: server.name,
    nodeName: typeof node?.name === "string" ? node.name : "",
    address: allocation ? `${host}:${allocation.port}` : "",
    online: server.status === "running",
  };
}

export async function attachPendingSubusers(user: { _id: { toString(): string }; email: string }) {
  await Subuser.updateMany(
    { email: user.email.toLowerCase(), userId: null },
    {
      $set: { userId: user._id, inviteTokenHash: null, inviteExpiresAt: null },
    },
  );
}

async function toSubuserDto(
  row: {
    _id: { toString(): string };
    serverId: { toString(): string };
    userId?: { toString(): string } | null;
    email: string;
    permissions: string[];
    inviteExpiresAt?: Date | null;
    createdAt: Date;
  },
  usersById: Map<string, { username: string; email: string }>,
) {
  const user = row.userId ? usersById.get(row.userId.toString()) : undefined;
  const pending = !row.userId;
  const inviteExpired = pending && row.inviteExpiresAt ? row.inviteExpiresAt.getTime() < Date.now() : false;
  return {
    id: row._id.toString(),
    email: row.email,
    username: user?.username ?? null,
    userId: row.userId?.toString() ?? null,
    permissions: normalizePermissions(row.permissions),
    pending,
    inviteExpired,
    createdAt: row.createdAt.toISOString(),
  };
}

async function usersForSubusers(rows: { userId?: { toString(): string } | null }[]) {
  const ids = [...new Set(rows.map((row) => row.userId?.toString()).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map<string, { username: string; email: string }>();
  const users = await User.find({ _id: { $in: ids } });
  return new Map(users.map((user) => [user._id.toString(), { username: user.username, email: user.email }]));
}

export async function listSubusers(serverId: string, viewerId: string, admin: boolean) {
  const access = await requireAccess(serverId, viewerId, admin, "user.read");
  const rows = await Subuser.find({ serverId: access.server._id }).sort({ createdAt: 1 });
  const usersById = await usersForSubusers(rows);
  return {
    subusers: await Promise.all(rows.map((row) => toSubuserDto(row, usersById))),
    canCreate: has(access, "user.create"),
    canUpdate: has(access, "user.update"),
    canDelete: has(access, "user.delete"),
  };
}

function has(
  access: { admin: boolean; owner: boolean; permissions: string[] },
  permission: ServerPermission,
) {
  try {
    assertPerm(access, permission);
    return true;
  } catch {
    return false;
  }
}

export async function searchUsers(serverId: string, viewerId: string, admin: boolean, query: string) {
  await requireAccess(serverId, viewerId, admin, "user.create");
  const q = query.trim();
  if (q.length < 2) return { users: [] as { id: string; username: string; email: string }[] };
  const rx = new RegExp(escapeRegex(q), "i");
  const rows = await User.find({ $or: [{ username: rx }, { email: rx }] })
    .sort({ username: 1 })
    .limit(8)
    .select({ username: 1, email: 1 });
  return {
    users: rows.map((row) => ({
      id: row._id.toString(),
      username: row.username,
      email: row.email,
    })),
  };
}

export async function createSubuser(
  serverId: string,
  viewerId: string,
  admin: boolean,
  body: unknown,
  actorName: string,
) {
  const parsed = subuserUpsertSchema.safeParse(body);
  if (!parsed.success) throw FlutterError.validation("Invalid subuser", parsed.error.flatten());
  const access = await requireAccess(serverId, viewerId, admin, "user.create");
  const permissions = normalizePermissions(parsed.data.permissions);
  const identifier = parsed.data.identifier.trim();
  const emailGuess = identifier.toLowerCase();

  let user =
    (await User.findOne({
      $or: [{ username: identifier }, { email: emailGuess }],
    })) ?? null;

  if (!user && !EMAIL_RE.test(emailGuess)) {
    throw FlutterError.validation("No matching user. Enter an email address to send an invite.");
  }

  const email = (user?.email ?? emailGuess).toLowerCase();
  const owner = await User.findById(access.server.ownerId);
  if (user && user._id.toString() === access.server.ownerId.toString()) {
    throw FlutterError.conflict("The server owner is already on this server");
  }
  if (owner && owner.email.toLowerCase() === email) {
    throw FlutterError.conflict("The server owner is already on this server");
  }
  if (user && user._id.toString() === viewerId && !admin) {
    throw FlutterError.conflict("You cannot add yourself as a subuser");
  }

  const existing = await Subuser.findOne({ serverId: access.server._id, email });
  if (existing) throw FlutterError.conflict("That user is already a subuser on this server");

  if (user) {
    const row = await Subuser.create({
      serverId: access.server._id,
      userId: user._id,
      email,
      permissions,
      invitedBy: viewerId,
    });
    const usersById = await usersForSubusers([row]);
    return { subuser: await toSubuserDto(row, usersById), emailed: false as const };
  }

  const token = randomToken(32);
  const row = await Subuser.create({
    serverId: access.server._id,
    userId: null,
    email,
    permissions,
    invitedBy: viewerId,
    inviteTokenHash: sha256(token),
    inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  const url = inviteUrl(token);
  const emailed = await sendSubuserInvite({
    to: email,
    inviterName: actorName,
    url,
    permissions,
    ...(await inviteMailContext(access.server)),
  });
  const usersById = await usersForSubusers([row]);
  return { subuser: await toSubuserDto(row, usersById), emailed, inviteUrl: url };
}

export async function updateSubuser(
  serverId: string,
  subuserId: string,
  viewerId: string,
  admin: boolean,
  body: unknown,
) {
  const parsed = subuserUpdateSchema.safeParse(body);
  if (!parsed.success) throw FlutterError.validation("Invalid permissions", parsed.error.flatten());
  const access = await requireAccess(serverId, viewerId, admin, "user.update");
  const row = await Subuser.findOne({ _id: subuserId, serverId: access.server._id });
  if (!row) throw FlutterError.notFound("Subuser not found");
  row.permissions = normalizePermissions(parsed.data.permissions);
  await row.save();
  const usersById = await usersForSubusers([row]);
  return { subuser: await toSubuserDto(row, usersById) };
}

export async function deleteSubuser(serverId: string, subuserId: string, viewerId: string, admin: boolean) {
  const access = await requireAccess(serverId, viewerId, admin, "user.delete");
  const row = await Subuser.findOne({ _id: subuserId, serverId: access.server._id });
  if (!row) throw FlutterError.notFound("Subuser not found");
  await Subuser.deleteOne({ _id: row._id });
  return { ok: true };
}

export async function resendSubuserInvite(
  serverId: string,
  subuserId: string,
  viewerId: string,
  admin: boolean,
  actorName: string,
) {
  const access = await requireAccess(serverId, viewerId, admin, "user.create");
  const row = await Subuser.findOne({ _id: subuserId, serverId: access.server._id });
  if (!row) throw FlutterError.notFound("Subuser not found");
  if (row.userId) throw FlutterError.conflict("This subuser already has an account");
  const token = randomToken(32);
  row.inviteTokenHash = sha256(token);
  row.inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await row.save();
  const url = inviteUrl(token);
  const emailed = await sendSubuserInvite({
    to: row.email,
    inviterName: actorName,
    url,
    permissions: normalizePermissions(row.permissions),
    ...(await inviteMailContext(access.server)),
  });
  const usersById = await usersForSubusers([row]);
  return { subuser: await toSubuserDto(row, usersById), emailed, inviteUrl: url };
}

export async function peekInvite(token: string) {
  const row = await Subuser.findOne({ inviteTokenHash: sha256(token) });
  if (!row) throw FlutterError.notFound("Invite not found or already used");
  const expired = !row.inviteExpiresAt || row.inviteExpiresAt.getTime() < Date.now();
  const server = await Server.findById(row.serverId);
  const existing = await User.findOne({ email: row.email });
  return {
    email: row.email,
    serverName: server?.name ?? "a server",
    expired,
    accountExists: Boolean(existing),
  };
}

export async function completeInvite(c: Context, body: unknown) {
  const parsed = inviteCompleteSchema.safeParse(body);
  if (!parsed.success) throw FlutterError.validation("Invalid invite", parsed.error.flatten());
  const passwordError = validatePassword(parsed.data.password);
  if (passwordError) throw FlutterError.validation(passwordError);

  const row = await Subuser.findOne({ inviteTokenHash: sha256(parsed.data.token) });
  if (!row) throw FlutterError.notFound("Invite not found or already used");
  if (!row.inviteExpiresAt || row.inviteExpiresAt.getTime() < Date.now()) {
    throw FlutterError.validation("This invite has expired. Ask the server owner to send a new one.");
  }

  const email = row.email.toLowerCase();
  const existing = await User.findOne({ $or: [{ email }, { username: parsed.data.username }] });
  if (existing) {
    if (existing.email === email) {
      throw FlutterError.conflict("An account with this email already exists. Sign in instead.");
    }
    throw FlutterError.conflict("Username is already taken");
  }

  const created = await User.create({
    username: parsed.data.username,
    email,
    passwordHash: await hashPassword(parsed.data.password),
    role: "user",
    emailVerified: true,
  });
  await attachPendingSubusers(created);
  await createSession(c, created._id.toString(), true);

  const memberships = await Subuser.find({ userId: created._id });
  const first = memberships[0];
  const perms = first ? normalizePermissions(first.permissions) : [];
  const href = first
    ? homePath(first.serverId.toString(), perms)
    : "/";
  return {
    user: publicUser(created),
    serverId: first?.serverId?.toString() ?? null,
    href,
  };
}

function homePath(serverId: string, permissions: ServerPermission[]) {
  const order = ["console", "files", "backups", "network", "startup", "users", "settings"] as const;
  for (const key of order) {
    const perm = NAV_PERMISSION[key];
    if (perm && hasServerPermission(permissions, perm)) return `/server/${serverId}/${key}`;
    if (key === "settings" && (hasServerPermission(permissions, "settings.rename") || hasServerPermission(permissions, "settings.reinstall"))) {
      return `/server/${serverId}/settings`;
    }
  }
  return `/`;
}
