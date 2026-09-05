import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "hono";
import mongoose from "mongoose";
import {
  ACTIVITY_FILE_STACK_MS,
  describeActivity,
  isActivityCategory,
  type ActivityActorKind,
  type ActivityCategory,
} from "@flutter-software/shared";
import { Activity, User } from "./db/models";
import { fileChangePreview, type FileChangePreview } from "./file-preview";
import { log } from "./log";

const PAGE_SIZE = 40;
const PROP_MAX = 400;
const PREVIEW_MAX = 16_000;
const ORIGIN_MAX = 200_000;
const SNAPSHOT_MAX = 24;
const SNAPSHOT_PREVIEW_MAX = 8_000;

export type ActivityActor = {
  id?: string | null;
  username?: string | null;
  kind?: ActivityActorKind;
  ip?: string | null;
};

const actorStore = new AsyncLocalStorage<ActivityActor>();

export function enterActivityContext(actor: ActivityActor) {
  actorStore.enterWith(actor);
}

export function runActivityContext<T>(actor: ActivityActor, fn: () => T): T {
  return actorStore.run(actor, fn);
}

export function currentActivityActor(): ActivityActor {
  return actorStore.getStore() ?? { kind: "system" };
}

export function requestIp(c: Context) {
  return (
    c.req.header("cf-connecting-ip")?.trim() ||
    c.req.header("x-real-ip")?.trim() ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    null
  );
}

function clip(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > PROP_MAX ? `${trimmed.slice(0, PROP_MAX)}…` : trimmed;
}

function sanitize(properties?: Record<string, unknown>) {
  if (!properties) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key === "origin" && typeof value === "string") {
      out[key] = value.length > ORIGIN_MAX ? value.slice(0, ORIGIN_MAX) : value;
      continue;
    }
    if (value == null || value === "") continue;
    if (key === "preview" && typeof value === "string") {
      out[key] = value.length > PREVIEW_MAX ? `${value.slice(0, PREVIEW_MAX)}\n…` : value;
      continue;
    }
    if (key === "snapshots" && Array.isArray(value)) {
      out[key] = value.slice(-SNAPSHOT_MAX).map(sanitizeSnapshot).filter(Boolean);
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = typeof value === "string" ? clip(value) : value;
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value
        .slice(0, 20)
        .map((item) => (typeof item === "string" ? clip(item) : String(item)))
        .filter(Boolean);
    }
  }
  return out;
}

function sanitizeSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const preview = typeof row.preview === "string" ? row.preview : "";
  return {
    at: typeof row.at === "string" ? row.at : "",
    added: typeof row.added === "number" && Number.isFinite(row.added) ? row.added : 0,
    removed: typeof row.removed === "number" && Number.isFinite(row.removed) ? row.removed : 0,
    created: Boolean(row.created),
    truncated: Boolean(row.truncated),
    preview: preview.length > SNAPSHOT_PREVIEW_MAX ? `${preview.slice(0, SNAPSHOT_PREVIEW_MAX)}\n…` : preview,
  };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveActor(actor?: ActivityActor): Promise<{
  actorId: string | null;
  actorKind: ActivityActorKind;
  actorName: string;
  ip: string | null;
}> {
  const current = actor ?? currentActivityActor();
  const kind: ActivityActorKind = current.kind ?? (current.id ? "user" : "system");
  let name = clip(current.username);
  if (!name && current.id) {
    const user = await User.findById(current.id).select({ username: 1 });
    name = user?.username ?? "";
  }
  if (!name) name = kind === "schedule" ? "Schedule" : kind === "user" ? "Unknown" : "System";
  return {
    actorId: current.id || null,
    actorKind: kind,
    actorName: name,
    ip: current.ip ?? currentActivityActor().ip ?? null,
  };
}

export function userActor(id: string, username?: string | null): ActivityActor {
  return { id, username: username || undefined, kind: "user" };
}

export function recordActivity(input: {
  serverId: string;
  event: string;
  category: ActivityCategory;
  actor?: ActivityActor;
  properties?: Record<string, unknown>;
}) {
  const actor = input.actor ?? { ...currentActivityActor() };
  void writeActivity({ ...input, actor });
}

export function recordFileWrite(input: {
  serverId: string;
  path?: string;
  after: string;
  actor?: ActivityActor;
  change: FileChangePreview | null;
}) {
  const actor = input.actor ?? { ...currentActivityActor() };
  void writeFileWrite({ ...input, actor });
}

async function writeActivity(input: {
  serverId: string;
  event: string;
  category: ActivityCategory;
  actor?: ActivityActor;
  properties?: Record<string, unknown>;
}) {
  try {
    const actor = await resolveActor(input.actor);
    await Activity.create({
      serverId: input.serverId,
      actorId: actor.actorId && mongoose.isValidObjectId(actor.actorId) ? actor.actorId : null,
      actorKind: actor.actorKind,
      actorName: actor.actorName,
      event: input.event,
      category: input.category,
      properties: sanitize(input.properties),
      ip: actor.ip,
    });
  } catch (error) {
    log("warn", "activity log failed", {
      serverId: input.serverId,
      event: input.event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function previewProperties(change: FileChangePreview | null) {
  if (!change) return {};
  return {
    added: change.added,
    removed: change.removed,
    created: change.created,
    truncated: change.truncated,
    preview: change.preview,
  };
}

function snapshotFrom(change: FileChangePreview | null, at: Date, fallback?: Record<string, unknown>) {
  if (change) {
    return {
      at: at.toISOString(),
      added: change.added,
      removed: change.removed,
      created: change.created,
      truncated: change.truncated,
      preview: change.preview,
    };
  }
  return {
    at: at.toISOString(),
    added: typeof fallback?.added === "number" ? fallback.added : 0,
    removed: typeof fallback?.removed === "number" ? fallback.removed : 0,
    created: Boolean(fallback?.created),
    truncated: Boolean(fallback?.truncated),
    preview: typeof fallback?.preview === "string" ? fallback.preview : "",
  };
}

function originFor(change: FileChangePreview | null) {
  if (!change) return undefined;
  if (change.before == null) return change.created ? "" : undefined;
  if (change.before.length > ORIGIN_MAX) return undefined;
  return change.before;
}

async function writeFileWrite(input: {
  serverId: string;
  path?: string;
  after: string;
  actor?: ActivityActor;
  change: FileChangePreview | null;
}) {
  try {
    const actor = await resolveActor(input.actor);
    const path = clip(input.path ?? "");
    const actorId = actor.actorId && mongoose.isValidObjectId(actor.actorId) ? actor.actorId : null;
    const actorFilter = actorId
      ? { actorId }
      : { actorId: null, actorKind: actor.actorKind, actorName: actor.actorName };
    const existing = path
      ? await Activity.findOne({
          serverId: input.serverId,
          event: "file.write",
          "properties.path": path,
          createdAt: { $gte: new Date(Date.now() - ACTIVITY_FILE_STACK_MS) },
          ...actorFilter,
        }).sort({ createdAt: -1 })
      : null;

    if (existing) {
      const props =
        existing.properties && typeof existing.properties === "object" && !Array.isArray(existing.properties)
          ? (existing.properties as Record<string, unknown>)
          : {};
      const storedOrigin = typeof props.origin === "string" ? props.origin : null;
      const saves = (typeof props.saves === "number" && props.saves >= 1 ? props.saves : 1) + 1;
      const stacked =
        storedOrigin != null ? fileChangePreview(storedOrigin === "" ? null : storedOrigin, input.after) : input.change;
      const prior = Array.isArray(props.snapshots) ? props.snapshots : [];
      const snapshots = [
        ...(prior.length ? prior : [snapshotFrom(null, existing.createdAt, props)]),
        snapshotFrom(input.change, new Date()),
      ].slice(-SNAPSHOT_MAX);
      await Activity.updateOne(
        { _id: existing._id },
        {
          $set: {
            properties: sanitize({
              ...props,
              path,
              saves,
              origin: storedOrigin ?? undefined,
              snapshots,
              ...previewProperties(stacked),
            }),
            createdAt: new Date(),
            ip: actor.ip ?? existing.ip,
          },
        },
      );
      return;
    }

    await Activity.create({
      serverId: input.serverId,
      actorId,
      actorKind: actor.actorKind,
      actorName: actor.actorName,
      event: "file.write",
      category: "files",
      properties: sanitize({
        path,
        saves: 1,
        origin: originFor(input.change),
        snapshots: [snapshotFrom(input.change, new Date())],
        ...previewProperties(input.change),
      }),
      ip: actor.ip,
    });
  } catch (error) {
    log("warn", "activity log failed", {
      serverId: input.serverId,
      event: "file.write",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function encodeCursor(createdAt: Date, id: string) {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined) {
  if (!value) return null;
  try {
    const [stamp, id] = Buffer.from(value, "base64url").toString("utf8").split("|");
    const createdAt = stamp ? new Date(stamp) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function publicEvent(row: {
  _id: { toString(): string };
  event: string;
  category: string;
  actorId?: { toString(): string } | null;
  actorKind?: string;
  actorName?: string;
  properties?: Record<string, unknown>;
  ip?: string | null;
  createdAt: Date;
}) {
  const raw =
    row.properties && typeof row.properties === "object" && !Array.isArray(row.properties)
      ? (row.properties as Record<string, unknown>)
      : {};
  const { origin: _origin, ...properties } = raw;
  return {
    id: row._id.toString(),
    event: row.event,
    category: isActivityCategory(row.category) ? row.category : "settings",
    title: describeActivity(row.event, properties),
    actor: {
      id: row.actorId?.toString() ?? null,
      name: row.actorName || "System",
      kind: (row.actorKind as ActivityActorKind) || "system",
    },
    ip: row.ip ?? null,
    properties,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listActivity(
  serverId: string,
  query: {
    category?: string;
    actor?: string;
    q?: string;
    cursor?: string;
  },
) {
  const filter: Record<string, unknown> = { serverId };
  if (query.category && isActivityCategory(query.category)) filter.category = query.category;
  if (query.actor?.trim()) filter.actorName = query.actor.trim();
  const needle = query.q?.trim() ?? "";
  if (needle) {
    const rx = new RegExp(escapeRegex(needle).slice(0, 80), "i");
    filter.$or = [
      { actorName: rx },
      { event: rx },
      { ip: rx },
      { "properties.path": rx },
      { "properties.to": rx },
      { "properties.name": rx },
      { "properties.email": rx },
    ];
  }

  const cursor = decodeCursor(query.cursor);
  if (cursor) {
    const cursorId = mongoose.isValidObjectId(cursor.id) ? new mongoose.Types.ObjectId(cursor.id) : cursor.id;
    filter.$and = [
      {
        $or: [
          { createdAt: { $lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, _id: { $lt: cursorId } },
        ],
      },
    ];
  }

  const rows = await Activity.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(PAGE_SIZE + 1);

  const extra = rows.length > PAGE_SIZE;
  const page = extra ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page[page.length - 1];
  const actors = await Activity.distinct("actorName", { serverId });

  return {
    events: page.map(publicEvent),
    nextCursor: extra && last ? encodeCursor(last.createdAt, last._id.toString()) : null,
    actors: (actors as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b)).slice(0, 40),
  };
}

export async function destroyServerActivity(serverId: { toString(): string }) {
  await Activity.deleteMany({ serverId });
}
