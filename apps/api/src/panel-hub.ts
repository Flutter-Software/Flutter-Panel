import type { WSContext } from "hono/ws";
import { lastExitSchema, type LastExit, type ServerStatus } from "@flutter-software/shared";
import { Server, Subuser, User } from "./db/models";
import { env, panelWsUrl } from "./env";
import { signPanelTicket } from "./panel-ticket";

export type PanelEvent =
  | {
      event: "server.status";
      data: { id: string; status: ServerStatus; lastExit: LastExit | null; uptime: string };
    }
  | {
      event: "server.stats";
      data: {
        id: string;
        cpu: number;
        memoryMb: number;
        diskMb: number;
        status?: ServerStatus;
        uptime?: string;
      };
    }
  | { event: "server.removed"; data: { id: string } }
  | { event: "servers.changed"; data: { id?: string; reason: "created" | "updated" | "deleted" | "membership" } }
  | {
      event: "node.status";
      data: {
        id: string;
        online: boolean;
        lastHeartbeatAt: string | null;
        maintenanceMode?: boolean;
        daemonVersion?: string | null;
        daemonListenUrl?: string | null;
      };
    }
  | { event: "nodes.changed"; data: { id?: string } }
  | { event: "schedule"; data: { serverId: string; schedule?: unknown; removed?: string } }
  | { event: "health"; data: unknown }
  | { event: "update.job"; data: unknown }
  | { event: "ping"; data: { at: number } };

type PanelSession = {
  ws: WSContext;
  userId: string;
  admin: boolean;
  serverIds: Set<string>;
};

const sessions = new Set<PanelSession>();
const byWs = new Map<WSContext, PanelSession>();
const lastNodeOnline = new Map<string, boolean>();
let onSubscribe: (() => void) | null = null;

export function onPanelSubscribe(fn: () => void) {
  onSubscribe = fn;
}

export function rememberNodeOnline(id: string, online: boolean) {
  const previous = lastNodeOnline.get(id);
  lastNodeOnline.set(id, online);
  return previous !== online;
}

function idOf(value: unknown) {
  if (value && typeof value === "object" && "toString" in value) return String(value);
  return String(value ?? "");
}

export async function loadServerIds(userId: string, admin: boolean) {
  if (admin) {
    const rows = await Server.find({}, { _id: 1 });
    return new Set(rows.map((row) => row._id.toString()));
  }
  const [owned, subs] = await Promise.all([
    Server.find({ ownerId: userId }, { _id: 1 }),
    Subuser.find({ userId }, { serverId: 1 }),
  ]);
  const ids = new Set(owned.map((row) => row._id.toString()));
  for (const row of subs) ids.add(idOf(row.serverId));
  return ids;
}

export function mintPanelSocket(userId: string, requestOrigin?: string) {
  return {
    token: signPanelTicket(env().SESSION_SECRET, userId),
    socket: panelWsUrl(requestOrigin),
  };
}

export async function attachPanelSession(ws: WSContext, userId: string) {
  const user = await User.findById(userId);
  if (!user) {
    sendRaw(ws, { event: "error", data: "Account not found" });
    ws.close();
    return null;
  }
  if (Number(ws.readyState) !== 1) return null;
  const admin = user.role === "admin";
  const session: PanelSession = {
    ws,
    userId: user._id.toString(),
    admin,
    serverIds: await loadServerIds(user._id.toString(), admin),
  };
  sessions.add(session);
  byWs.set(ws, session);
  sendRaw(ws, { event: "hello", data: { admin } });
  if (sessions.size === 1) onSubscribe?.();
  return session;
}

export function detachPanelSession(ws: WSContext) {
  const session = byWs.get(ws);
  if (!session) return;
  byWs.delete(ws);
  sessions.delete(session);
}

export function panelHasSubscribers() {
  return sessions.size > 0;
}

export function panelHasAdmins() {
  for (const session of sessions) {
    if (session.admin) return true;
  }
  return false;
}

export function subscribedServerIds() {
  const ids = new Set<string>();
  for (const session of sessions) {
    for (const id of session.serverIds) ids.add(id);
  }
  return [...ids];
}

export function grantServerAccess(serverId: string, userIds: string[]) {
  const allow = new Set(userIds);
  for (const session of sessions) {
    if (session.admin || allow.has(session.userId)) session.serverIds.add(serverId);
  }
}

export function revokeServerAccess(serverId: string) {
  for (const session of sessions) session.serverIds.delete(serverId);
}

export function revokeUserServerAccess(userId: string, serverId: string) {
  for (const session of sessions) {
    if (!session.admin && session.userId === userId) session.serverIds.delete(serverId);
  }
}

export async function refreshPanelMembership() {
  if (!sessions.size) return;
  await Promise.all(
    [...sessions].map(async (session) => {
      const next = await loadServerIds(session.userId, session.admin);
      let changed = next.size !== session.serverIds.size;
      if (!changed) {
        for (const id of next) {
          if (!session.serverIds.has(id)) {
            changed = true;
            break;
          }
        }
      }
      session.serverIds = next;
      if (changed) sendTo(session, { event: "servers.changed", data: { reason: "membership" } });
    }),
  );
}

function visible(session: PanelSession, frame: PanelEvent) {
  switch (frame.event) {
    case "health":
    case "update.job":
    case "nodes.changed":
    case "node.status":
      return session.admin;
    case "ping":
      return true;
    case "server.removed":
    case "server.status":
    case "server.stats":
      return session.admin || session.serverIds.has(frame.data.id);
    case "servers.changed":
      return !frame.data.id || session.admin || session.serverIds.has(frame.data.id);
    case "schedule":
      return session.admin || session.serverIds.has(frame.data.serverId);
    default:
      return false;
  }
}

function sendRaw(ws: WSContext, payload: unknown) {
  if (Number(ws.readyState) !== 1) return;
  ws.send(JSON.stringify(payload));
}

function sendTo(session: PanelSession, frame: PanelEvent) {
  sendRaw(session.ws, frame);
}

export function publishToUser(userId: string, frame: PanelEvent) {
  for (const session of sessions) {
    if (session.userId === userId) sendTo(session, frame);
  }
}

export function publish(frame: PanelEvent) {
  for (const session of sessions) {
    if (!visible(session, frame)) continue;
    sendTo(session, frame);
  }
}

export function pingPanelSessions() {
  publish({ event: "ping", data: { at: Date.now() } });
}

function uptimeFor(status: string) {
  return status === "running" ? "Running" : status === "installing" ? "Installing" : "Offline";
}

export function publishServerStatus(input: { id: string; status: string; lastExit?: unknown }) {
  const status = (input.status || "offline") as ServerStatus;
  const parsed = lastExitSchema.safeParse(input.lastExit);
  publish({
    event: "server.status",
    data: {
      id: input.id,
      status,
      lastExit: parsed.success ? parsed.data : null,
      uptime: uptimeFor(status),
    },
  });
}

export function publishServersChanged(
  reason: "created" | "updated" | "deleted" | "membership",
  id?: string,
) {
  publish({ event: "servers.changed", data: { id, reason } });
}

export function publishServerRemoved(id: string) {
  publish({ event: "server.removed", data: { id } });
}

export function publishNodesChanged(id?: string) {
  publish({ event: "nodes.changed", data: { id } });
}
