import {
  API_KEY_APPLICATION_PREFIX,
  API_KEY_CLIENT_PREFIX,
  API_KEY_MAX_PER_USER,
  FlutterError,
  apiKeyCreateSchema,
  applicationScopeForPath,
  isApplicationScope,
  type ApiKeyKind,
  type PublicUser,
} from "@flutter-software/shared";
import { readBearerToken } from "@flutter-software/shared/ticket";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "hono";
import mongoose from "mongoose";
import { ApiKey, User } from "../db/models";
import { publicUser, randomToken, sha256 } from "./crypto";

export type AuthVia = "session" | "client-key" | "application-key";

export type AuthState = {
  user: PublicUser;
  sessionId: string | null;
  via: AuthVia;
  apiKeyId: string | null;
  serverIds: string[] | null;
  scopes: string[];
};

const lastUsedAt = new Map<string, number>();
const limitsStore = new AsyncLocalStorage<{ serverIds: string[] | null }>();

export function currentApiKeyLimits() {
  return limitsStore.getStore() ?? { serverIds: null };
}

export function runApiKeyLimits<T>(serverIds: string[] | null, fn: () => T): T {
  return limitsStore.run({ serverIds }, fn);
}

export function bearerApiKey(c: Context) {
  const token = readBearerToken(c.req.header("authorization"));
  if (token.startsWith(API_KEY_CLIENT_PREFIX) || token.startsWith(API_KEY_APPLICATION_PREFIX)) return token;
  return "";
}

function publicKey(row: {
  _id: { toString(): string };
  kind: string;
  name: string;
  tokenPrefix: string;
  serverIds?: { toString(): string }[];
  scopes?: string[];
  lastUsedAt?: Date | null;
  expiresAt?: Date | null;
  createdAt?: Date;
}) {
  const serverIds = (row.serverIds ?? []).map((id: { toString(): string }) => id.toString());
  return {
    id: row._id.toString(),
    kind: row.kind as ApiKeyKind,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    serverIds,
    allServers: row.kind === "client" && serverIds.length === 0,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

function touchLastUsed(id: string) {
  const now = Date.now();
  const previous = lastUsedAt.get(id) ?? 0;
  if (now - previous < 60_000) return;
  lastUsedAt.set(id, now);
  void ApiKey.updateOne({ _id: id }, { $set: { lastUsedAt: new Date() } });
}

export async function resolveApiKey(token: string): Promise<AuthState | null> {
  const kind: ApiKeyKind = token.startsWith(API_KEY_APPLICATION_PREFIX) ? "application" : "client";
  const row = await ApiKey.findOne({ tokenHash: sha256(token), kind });
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  const user = await User.findById(row.userId);
  if (!user || user.emailVerified === false) return null;
  if (kind === "application" && user.role !== "admin") return null;
  touchLastUsed(row._id.toString());
  const serverIds = (row.serverIds ?? []).map((id: { toString(): string }) => id.toString());
  return {
    user: publicUser(user),
    sessionId: null,
    via: kind === "application" ? "application-key" : "client-key",
    apiKeyId: row._id.toString(),
    serverIds: kind === "client" && serverIds.length ? serverIds : null,
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
  };
}

export function assertApplicationScope(c: Context, auth: AuthState) {
  if (auth.via !== "application-key") return;
  if (auth.scopes.includes("*")) return;
  const write = !["GET", "HEAD", "OPTIONS"].includes(c.req.method.toUpperCase());
  const need = applicationScopeForPath(c.req.path, write);
  if (!need) return;
  if (auth.scopes.includes(need)) return;
  const writeScope = need.replace(".read", ".write");
  if (!write && auth.scopes.includes(writeScope)) return;
  throw FlutterError.forbidden(`This application key is missing the ${need} scope`);
}

export async function listApiKeys(userId: string, admin: boolean) {
  const rows = await ApiKey.find({ userId }).sort({ createdAt: -1 });
  const keys = rows.filter((row) => row.kind !== "application" || admin).map(publicKey);
  return { keys };
}

export async function createApiKey(
  user: { id: string; role: string },
  body: unknown,
  ip: string | null,
) {
  const parsed = apiKeyCreateSchema.safeParse(body);
  if (!parsed.success) throw FlutterError.validation("Invalid API key", parsed.error.flatten());

  const kind = parsed.data.kind;
  if (kind === "application" && user.role !== "admin") {
    throw FlutterError.forbidden("Only admins can create application keys");
  }

  const count = await ApiKey.countDocuments({ userId: user.id });
  if (count >= API_KEY_MAX_PER_USER) {
    throw FlutterError.validation(`You can have at most ${API_KEY_MAX_PER_USER} API keys`);
  }

  const prefix = kind === "application" ? API_KEY_APPLICATION_PREFIX : API_KEY_CLIENT_PREFIX;
  const token = `${prefix}${randomToken(24)}`;
  const serverIds =
    kind === "client" ? (parsed.data.serverIds ?? []).filter((id) => mongoose.isValidObjectId(id)) : [];
  let scopes: string[] = [];
  if (kind === "application") {
    const requested = parsed.data.scopes ?? ["*"];
    if (requested.includes("*") || requested.length === 0) scopes = ["*"];
    else scopes = requested.filter((scope) => scope === "*" || isApplicationScope(scope));
    if (!scopes.length) scopes = ["*"];
  }

  const expiresAt =
    typeof parsed.data.expiresInDays === "number"
      ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

  const row = await ApiKey.create({
    userId: user.id,
    kind,
    name: parsed.data.name,
    tokenHash: sha256(token),
    tokenPrefix: token.slice(0, 12),
    serverIds,
    scopes,
    expiresAt,
    ip,
  });

  return { key: publicKey(row), token };
}

export async function destroyApiKey(userId: string, id: string) {
  if (!mongoose.isValidObjectId(id)) throw FlutterError.notFound("API key not found");
  const result = await ApiKey.deleteOne({ _id: id, userId });
  if (!result.deletedCount) throw FlutterError.notFound("API key not found");
  return { ok: true };
}
