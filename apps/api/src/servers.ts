import { randomUUID } from "node:crypto";
import {
  FlutterError,
  allocationUpdateSchema,
  hasServerPermission,
  lastExitSchema,
  powerActionSchema,
  serverCreateSchema,
  serverUpdateSchema,
  uploadLimitBytes,
  type LastExit,
  type PowerAction,
  type ServerPermission,
  type ServerStatus,
} from "@flutter-software/shared";
import { Allocation, Egg, Location, Node, Schedule, Server, Subuser, User } from "./db/models";
import { currentApiKeyLimits } from "./auth/api-keys";
import {
  backupsOnNode,
  commandOnNode,
  destroyOnNode,
  downloadOnNode,
  filesOnNode,
  installOnNode,
  logsOnNode,
  powerOnNode,
  statsOnNode,
  statsForServers,
  type InstallSpec,
} from "./daemon";
import { env, consoleWsUrl } from "./env";
import { isNodeOnline } from "./nodes";
import { log } from "./log";
import { signConsoleTicket } from "./console-ticket";
import { destroyServerActivity, recordActivity, recordFileWrite, userActor } from "./activity";
import { fileChangePreview } from "./file-preview";

function publicLastExit(value: unknown): LastExit | null {
  const parsed = lastExitSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function envRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function processFrom(
  server: { dockerImage?: string; startup?: string; stopCommand?: string },
  egg: { dockerImage?: string; startup?: string; stopCommand?: string } | null,
) {
  const snapshotted = Boolean(server.dockerImage);
  return {
    dockerImage: snapshotted ? server.dockerImage ?? "" : (egg?.dockerImage ?? ""),
    startup: snapshotted ? (server.startup ?? "") : (egg?.startup ?? ""),
    stopCommand: snapshotted ? (server.stopCommand || "stop") : (egg?.stopCommand || "stop"),
  };
}

function eggDefaults(egg: { variables?: unknown }): Record<string, string> {
  const variables = Array.isArray(egg.variables) ? egg.variables : [];
  const out: Record<string, string> = {};
  for (const item of variables) {
    const variable = item as { key?: string; default?: string };
    if (variable.key) out[variable.key] = variable.default ?? "";
  }
  return out;
}

const HTTP_PORTS = new Set([80, 443, 3000, 3001, 5000, 5173, 8000, 8080, 8081, 8443, 8888, 9000]);
const HTTP_EGG_RE =
  /\b(nginx|apache|caddy|httpd|website|webserver|web server|gitea|wordpress|nextcloud|ghost|code-?server|phpmyadmin)\b/i;

function allocationHost(row: { ip: string; alias?: string | null }) {
  const alias = typeof row.alias === "string" ? row.alias.trim() : "";
  return alias || row.ip;
}

function allocationDisplay(row: { ip: string; alias?: string | null; port: number }) {
  return `${allocationHost(row)}:${row.port}`;
}

function allocationBrowserUrl(row: { ip: string; alias?: string | null; port: number }) {
  const host = allocationHost(row);
  const wrapped = host.includes(":") ? `[${host.replace(/^\[|\]$/g, "")}]` : host;
  const scheme = row.port === 443 ? "https" : "http";
  if ((scheme === "https" && row.port === 443) || (scheme === "http" && row.port === 80)) {
    return `${scheme}://${wrapped}`;
  }
  return `${scheme}://${wrapped}:${row.port}`;
}

function allocationIsHttp(eggName: string, eggDescription: string, port: number) {
  if (HTTP_PORTS.has(port)) return true;
  return HTTP_EGG_RE.test(`${eggName} ${eggDescription}`);
}

async function relatedMany(
  servers: {
    eggId: { toString(): string };
    nodeId: { toString(): string };
    allocationId: { toString(): string };
    ownerId: { toString(): string };
  }[],
) {
  if (servers.length === 0) return [];
  const eggIds = [...new Set(servers.map((row) => row.eggId.toString()))];
  const nodeIds = [...new Set(servers.map((row) => row.nodeId.toString()))];
  const allocationIds = [...new Set(servers.map((row) => row.allocationId.toString()))];
  const ownerIds = [...new Set(servers.map((row) => row.ownerId.toString()))];
  const [eggs, nodes, allocations, owners] = await Promise.all([
    Egg.find({ _id: { $in: eggIds } }),
    Node.find({ _id: { $in: nodeIds } }),
    Allocation.find({ _id: { $in: allocationIds } }),
    User.find({ _id: { $in: ownerIds } }),
  ]);
  const locationIds = [...new Set(nodes.map((node) => node.locationId.toString()))];
  const locations = await Location.find({ _id: { $in: locationIds } });
  const eggsById = new Map(eggs.map((row) => [row._id.toString(), row]));
  const nodesById = new Map(nodes.map((row) => [row._id.toString(), row]));
  const allocationsById = new Map(allocations.map((row) => [row._id.toString(), row]));
  const ownersById = new Map(owners.map((row) => [row._id.toString(), row]));
  const locationsById = new Map(locations.map((row) => [row._id.toString(), row]));
  return servers.map((server) => {
    const node = nodesById.get(server.nodeId.toString()) ?? null;
    return {
      egg: eggsById.get(server.eggId.toString()) ?? null,
      node,
      allocation: allocationsById.get(server.allocationId.toString()) ?? null,
      owner: ownersById.get(server.ownerId.toString()) ?? null,
      location: node ? locationsById.get(node.locationId.toString()) ?? null : null,
    };
  });
}

async function related(server: {
  eggId: { toString(): string };
  nodeId: { toString(): string };
  allocationId: { toString(): string };
  ownerId: { toString(): string };
}) {
  return (await relatedMany([server]))[0];
}

export function toClientServer(
  server: {
    _id: { toString(): string };
    uuid: string;
    name: string;
    description: string;
    ownerId: { toString(): string };
    nodeId: { toString(): string };
    eggId: { toString(): string };
    allocationId: { toString(): string };
    memoryMb: number;
    diskMb: number;
    cpuPercent: number;
    cpuPinning?: number;
    databaseLimit?: number;
    backupsEnabled?: boolean;
    dockerImage?: string;
    startup?: string;
    stopCommand?: string;
    status: string;
    lastExit?: unknown;
    environment: unknown;
  },
  relatedDocs: Awaited<ReturnType<typeof related>>,
  viewerId: string,
  permissions: string[],
) {
  const { egg, node, allocation, owner, location } = relatedDocs;
  const process = processFrom(server, egg);
  const status = (server.status as ServerStatus) || "offline";
  return {
    id: server._id.toString(),
    uuid: server.uuid,
    name: server.name,
    description: server.description,
    egg: egg?.name ?? "Unknown egg",
    eggId: server.eggId.toString(),
    node: node?.name ?? "Unknown node",
    nodeId: server.nodeId.toString(),
    nodeLocation: location?.shortCode ?? "",
    allocation: allocation ? allocationDisplay(allocation) : "unassigned",
    allocationId: server.allocationId.toString(),
    status,
    lastExit: publicLastExit(server.lastExit),
    owner: server.ownerId.toString() === viewerId,
    ownerId: server.ownerId.toString(),
    ownerName: owner?.username ?? "unknown",
    permissions,
    uptime: status === "running" ? "Running" : status === "installing" ? "Installing" : "Offline",
    cpu: { used: 0, limit: server.cpuPercent },
    memory: { usedMb: 0, limitMb: server.memoryMb },
    disk: { usedMb: 0, limitMb: server.diskMb },
    cpuPinning: Number(server.cpuPinning) || 0,
    databaseLimit: Number(server.databaseLimit) || 0,
    backupsEnabled: server.backupsEnabled !== false,
    dockerImage: process.dockerImage,
    startup: process.startup,
    stopCommand: process.stopCommand,
    environment: envRecord(server.environment),
    eggVariables: Array.isArray(egg?.variables)
      ? (egg.variables as { key?: string; default?: string; description?: string }[]).map((variable) => ({
          key: variable.key ?? "",
          default: variable.default ?? "",
          description: variable.description ?? "",
        })).filter((variable) => variable.key)
      : [],
    nodeOnline: isNodeOnline(node?.lastHeartbeatAt),
    nodeMaintenance: Boolean(node?.maintenanceMode),
    uploadLimitBytes: uploadLimitBytes(node?.uploadLimitMb),
    sftpHost: node?.fqdn ?? "",
    sftpPort: node?.sftpPort ?? 2022,
  };
}

export type ServerAccess = {
  server: Awaited<ReturnType<typeof Server.findById>> & object;
  permissions: string[];
  owner: boolean;
  admin: boolean;
};

export function assertPerm(
  access: { admin: boolean; owner: boolean; permissions: string[] },
  permission: ServerPermission,
) {
  if (access.admin || access.owner || hasServerPermission(access.permissions, permission)) return;
  throw FlutterError.forbidden("You do not have permission to do that");
}

export async function requireAccess(
  serverId: string,
  viewerId: string,
  admin: boolean,
  permission?: ServerPermission,
) {
  const server = await Server.findById(serverId);
  if (!server) throw FlutterError.notFound("Server not found");
  const owner = server.ownerId.toString() === viewerId;
  const allowed = currentApiKeyLimits().serverIds;
  if (allowed && !allowed.includes(server._id.toString())) {
    throw FlutterError.forbidden("This API key cannot access this server");
  }
  if (admin || owner) {
    const access = { server, permissions: ["*"], owner, admin };
    if (permission) assertPerm(access, permission);
    return access;
  }
  const sub = await Subuser.findOne({ serverId: server._id, userId: viewerId });
  if (!sub) throw FlutterError.forbidden("You do not have access to this server");
  const access = {
    server,
    permissions: Array.isArray(sub.permissions) ? sub.permissions.map(String) : [],
    owner: false,
    admin: false,
  };
  if (permission) assertPerm(access, permission);
  return access;
}

async function loadClient(serverId: string, viewerId: string, admin: boolean) {
  const access = await requireAccess(serverId, viewerId, admin);
  return toClientServer(access.server, await related(access.server), viewerId, access.permissions);
}

function toSpec(
  server: {
    uuid: string;
    name: string;
    memoryMb: number;
    diskMb: number;
    cpuPercent: number;
    cpuPinning?: number;
    dockerImage?: string;
    startup?: string;
    stopCommand?: string;
    environment: unknown;
  },
  egg: {
    dockerImage: string;
    startup: string;
    stopCommand: string;
    installScript: string;
    installImage: string;
    variables?: unknown;
  },
  allocation: { ip: string; port: number },
  extraAllocations: { ip: string; port: number }[] = [],
): InstallSpec {
  const process = processFrom(server, egg);
  return {
    uuid: server.uuid,
    name: server.name,
    dockerImage: process.dockerImage,
    startup: process.startup,
    stopCommand: process.stopCommand,
    installScript: egg.installScript,
    installImage: egg.installImage,
    // Egg defaults first; the server's saved env wins on conflict.
    environment: { ...eggDefaults(egg), ...envRecord(server.environment) },
    limits: {
      memoryBytes: Math.max(0, server.memoryMb) * 1024 * 1024,
      diskBytes: Math.max(0, server.diskMb) * 1024 * 1024,
      cpuPercent: Math.max(0, server.cpuPercent),
      cpuPinning: Math.max(0, Number(server.cpuPinning) || 0),
    },
    allocation: { ip: allocation.ip, port: allocation.port },
    allocations: extraAllocations.map((row) => ({ ip: row.ip, port: row.port })),
  };
}

async function extraAllocationsFor(serverId: string, primaryId: string) {
  const rows = await Allocation.find({ serverId, _id: { $ne: primaryId } }).sort({ port: 1 });
  return rows.map((row) => ({ ip: row.ip, port: row.port }));
}

async function specFor(
  server: Parameters<typeof toSpec>[0] & { _id: { toString(): string }; allocationId: { toString(): string } },
  egg: Parameters<typeof toSpec>[1],
  allocation: Parameters<typeof toSpec>[2],
) {
  return toSpec(
    server,
    egg,
    allocation,
    await extraAllocationsFor(server._id.toString(), server.allocationId.toString()),
  );
}

async function assignExtraAllocations(
  serverId: string,
  nodeId: string,
  primaryId: string,
  extraIds: string[],
) {
  const unique = [...new Set(extraIds)].filter((id) => id !== primaryId);
  const rows = unique.length ? await Allocation.find({ _id: { $in: unique } }) : [];
  if (rows.length !== unique.length) throw FlutterError.notFound("Allocation not found");
  for (const row of rows) {
    if (row.nodeId.toString() !== nodeId) {
      throw FlutterError.validation("Allocation does not belong to this node");
    }
    if (row.serverId && row.serverId.toString() !== serverId) {
      throw FlutterError.conflict("Allocation is already assigned");
    }
  }
  await Allocation.updateMany(
    { serverId, _id: { $nin: [primaryId, ...unique] } },
    { $set: { serverId: null } },
  );
  if (unique.length) {
    await Allocation.updateMany({ _id: { $in: unique } }, { $set: { serverId } });
  }
}

export async function listClientServers(viewerId: string, admin: boolean) {
  const subs = admin ? [] : await Subuser.find({ userId: viewerId });
  const sharedIds = subs.map((row) => row.serverId);
  const permByServer = new Map(subs.map((row) => [row.serverId.toString(), row.permissions.map(String)]));
  // Admin dashboard reuses the client payload. Empty query = every server.
  const query = admin ? {} : { $or: [{ ownerId: viewerId }, { _id: { $in: sharedIds } }] };
  let rows = await Server.find(query).sort({ name: 1 });
  const allowed = currentApiKeyLimits().serverIds;
  if (allowed) {
    const allow = new Set(allowed);
    rows = rows.filter((row) => allow.has(row._id.toString()));
  }
  const relatedDocs = await relatedMany(rows);
  const clients = rows.map((row, index) => {
    const owner = row.ownerId.toString() === viewerId;
    const permissions = admin || owner ? ["*"] : (permByServer.get(row._id.toString()) ?? []);
    return toClientServer(row, relatedDocs[index], viewerId, permissions);
  });
  return withLiveUsageMany(clients);
}

export async function getClientServer(serverId: string, viewerId: string, admin: boolean) {
  const [client] = await withLiveUsageMany([await loadClient(serverId, viewerId, admin)]);
  return client;
}

function applyLiveUsage(
  client: ReturnType<typeof toClientServer>,
  live: Awaited<ReturnType<typeof statsOnNode>>,
) {
  if (typeof live.diskBytes === "number" && live.diskBytes > 0) {
    client.disk.usedMb = Math.round((live.diskBytes / 1024 / 1024) * 10) / 10;
  }
  const stats = live.stats;
  if (stats) {
    if (typeof stats.cpuPercent === "number") client.cpu.used = stats.cpuPercent;
    if (typeof stats.memoryBytes === "number") {
      client.memory.usedMb = Math.round((stats.memoryBytes / 1024 / 1024) * 10) / 10;
    }
  }
  if (live.running && (client.status === "offline" || client.status === "starting")) {
    client.status = "running";
  }
}

async function withLiveUsageMany(clients: ReturnType<typeof toClientServer>[]) {
  const targets = clients.filter(
    (client) =>
      client.nodeOnline &&
      client.status !== "installing" &&
      client.status !== "install_failed" &&
      client.uuid &&
      client.nodeId,
  );
  if (!targets.length) return clients;
  try {
    const live = await statsForServers(targets.map((client) => ({ nodeId: client.nodeId, uuid: client.uuid })));
    for (const client of targets) {
      const row = live.get(client.uuid);
      if (row) applyLiveUsage(client, row);
    }
  } catch {
    /* keep zeros if the batch fails */
  }
  return clients;
}

export async function createServer(body: unknown, actorId: string) {
  const parsed = serverCreateSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Invalid server", parsed.error.flatten());
  }
  const ownerId = parsed.data.ownerId ?? actorId;
  const [egg, node, allocation, owner] = await Promise.all([
    Egg.findById(parsed.data.eggId),
    Node.findById(parsed.data.nodeId),
    Allocation.findById(parsed.data.allocationId),
    User.findById(ownerId),
  ]);
  if (!egg) throw FlutterError.notFound("Egg not found");
  if (!node) throw FlutterError.notFound("Node not found");
  if (!allocation) throw FlutterError.notFound("Allocation not found");
  if (!owner) throw FlutterError.notFound("Owner not found");
  if (allocation.nodeId.toString() !== node._id.toString()) {
    throw FlutterError.validation("Allocation does not belong to this node");
  }
  if (allocation.serverId) throw FlutterError.conflict("Allocation is already assigned");
  if (!isNodeOnline(node.lastHeartbeatAt) || !node.daemonListenUrl) {
    throw FlutterError.unavailable("Node daemon is offline. Start the daemon before creating a server.");
  }

  const environment = { ...eggDefaults(egg), ...parsed.data.environment };
  const row = await Server.create({
    uuid: randomUUID(),
    name: parsed.data.name,
    description: parsed.data.description ?? "",
    ownerId,
    nodeId: node._id,
    eggId: egg._id,
    allocationId: allocation._id,
    memoryMb: parsed.data.memoryMb,
    diskMb: parsed.data.diskMb,
    cpuPercent: parsed.data.cpuPercent ?? 100,
    cpuPinning: parsed.data.cpuPinning ?? 0,
    databaseLimit: parsed.data.databaseLimit ?? 0,
    backupsEnabled: parsed.data.backupsEnabled ?? true,
    dockerImage: parsed.data.dockerImage?.trim() || egg.dockerImage,
    startup: parsed.data.startup !== undefined ? parsed.data.startup : egg.startup,
    stopCommand: parsed.data.stopCommand?.trim() || egg.stopCommand || "stop",
    status: "installing",
    environment,
  });
  await Allocation.updateOne({ _id: allocation._id }, { $set: { serverId: row._id } });
  await assignExtraAllocations(
    row._id.toString(),
    node._id.toString(),
    allocation._id.toString(),
    parsed.data.allocationIds ?? [],
  );
  void runInstall(row._id.toString());
  return toClientServer(row, await related(row), actorId, ["*"]);
}

export async function updateServer(serverId: string, body: unknown, actorId: string) {
  const parsed = serverUpdateSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Invalid server", parsed.error.flatten());
  }
  const server = await Server.findById(serverId);
  if (!server) throw FlutterError.notFound("Server not found");

  if (parsed.data.name) server.name = parsed.data.name;
  if (parsed.data.description !== undefined) server.description = parsed.data.description;
  if (parsed.data.memoryMb !== undefined) server.memoryMb = parsed.data.memoryMb;
  if (parsed.data.diskMb !== undefined) server.diskMb = parsed.data.diskMb;
  if (parsed.data.cpuPercent !== undefined) server.cpuPercent = parsed.data.cpuPercent;
  if (parsed.data.cpuPinning !== undefined) server.cpuPinning = parsed.data.cpuPinning;
  if (parsed.data.databaseLimit !== undefined) server.databaseLimit = parsed.data.databaseLimit;
  if (parsed.data.backupsEnabled !== undefined) server.backupsEnabled = parsed.data.backupsEnabled;
  if (parsed.data.environment) {
    server.environment = parsed.data.environment;
    server.markModified("environment");
  }

  if (parsed.data.ownerId && parsed.data.ownerId !== server.ownerId.toString()) {
    const owner = await User.findById(parsed.data.ownerId);
    if (!owner) throw FlutterError.notFound("Owner not found");
    server.ownerId = owner._id;
  }

  if (parsed.data.allocationId && parsed.data.allocationId !== server.allocationId.toString()) {
    const next = await Allocation.findById(parsed.data.allocationId);
    if (!next) throw FlutterError.notFound("Allocation not found");
    if (next.nodeId.toString() !== server.nodeId.toString()) {
      throw FlutterError.validation("Allocation must belong to this server's node");
    }
    if (next.serverId && next.serverId.toString() !== server._id.toString()) {
      throw FlutterError.conflict("Allocation is already assigned");
    }
    await Allocation.updateOne({ _id: server.allocationId }, { $set: { serverId: null } });
    await Allocation.updateOne({ _id: next._id }, { $set: { serverId: server._id } });
    server.allocationId = next._id;
  }

  if (parsed.data.allocationIds) {
    await assignExtraAllocations(
      server._id.toString(),
      server.nodeId.toString(),
      server.allocationId.toString(),
      parsed.data.allocationIds,
    );
  }

  await server.save();
  const id = server._id.toString();
  if (parsed.data.name || parsed.data.description !== undefined) {
    recordActivity({
      serverId: id,
      event: "settings.rename",
      category: "settings",
      actor: userActor(actorId),
      properties: { name: server.name },
    });
  }
  if (parsed.data.environment) {
    recordActivity({
      serverId: id,
      event: "startup.update",
      category: "startup",
      actor: userActor(actorId),
      properties: { keys: Object.keys(parsed.data.environment) },
    });
  }
  const fields = (
    ["memoryMb", "diskMb", "cpuPercent", "ownerId", "allocationId", "databaseLimit", "backupsEnabled"] as const
  ).filter((key) => parsed.data[key] !== undefined);
  if (fields.length) {
    recordActivity({
      serverId: id,
      event: "settings.update",
      category: "settings",
      actor: userActor(actorId),
      properties: { fields },
    });
  }
  return toClientServer(server, await related(server), actorId, ["*"]);
}

export async function reinstallServer(serverId: string, viewerId: string, admin: boolean) {
  const access = await requireAccess(serverId, viewerId, admin, "settings.reinstall");
  const server = access.server;
  const docs = await related(server);
  if (!docs.egg || !docs.allocation) throw FlutterError.notFound("Server is missing egg or allocation");
  if (!isNodeOnline(docs.node?.lastHeartbeatAt) || !docs.node?.daemonListenUrl) {
    throw FlutterError.unavailable("Node daemon is offline");
  }
  server.status = "installing";
  await server.save();
  recordActivity({
    serverId: server._id.toString(),
    event: "settings.reinstall",
    category: "settings",
    actor: userActor(viewerId),
  });
  void runInstall(server._id.toString());
  return toClientServer(server, docs, viewerId, access.permissions);
}

export async function powerServer(
  serverId: string,
  viewerId: string,
  admin: boolean,
  body: unknown,
) {
  const parsed = powerActionSchema.safeParse(
    typeof body === "object" && body && "action" in body
      ? (body as { action: unknown }).action
      : body,
  );
  if (!parsed.success) {
    throw FlutterError.validation("action must be start, stop, restart, or kill");
  }
  const action: PowerAction = parsed.data;
  const permission: ServerPermission =
    action === "start" ? "control.start" : action === "restart" ? "control.restart" : "control.stop";
  const access = await requireAccess(serverId, viewerId, admin, permission);
  const server = access.server;
  const docs = await related(server);
  if (!docs.egg || !docs.allocation) throw FlutterError.notFound("Server is missing egg or allocation");
  if (server.status === "installing") {
    throw FlutterError.conflict("Wait for install to finish before sending power actions");
  }

  server.status = action === "start" || action === "restart" ? "starting" : "stopping";
  await server.save();
  recordActivity({
    serverId: server._id.toString(),
    event: `power.${action}`,
    category: "power",
    actor: userActor(viewerId),
  });
  const spec = await specFor(server, docs.egg, docs.allocation);
  const nodeId = server.nodeId.toString();
  const id = server._id.toString();
  void finishPower(id, nodeId, spec, action);
  return toClientServer(server, docs, viewerId, access.permissions);
}

async function finishPower(serverId: string, nodeId: string, spec: InstallSpec, action: PowerAction) {
  try {
    await powerOnNode(nodeId, spec, action);
  } catch (error) {
    log("error", "power action failed", {
      serverId,
      action,
      error: error instanceof Error ? error.message : String(error),
    });
    const row = await Server.findById(serverId);
    if (!row || row.status === "installing" || row.status === "install_failed") return;
    if (row.status === "starting" || row.status === "stopping") {
      row.status = "offline";
      await row.save();
    }
  }
}

export async function deleteServer(serverId: string) {
  const server = await Server.findById(serverId);
  if (!server) throw FlutterError.notFound("Server not found");
  try {
    await destroyOnNode(server.nodeId.toString(), server.uuid);
  } catch {
    // Node may already be gone; still drop the panel record.
  }
  await Allocation.updateMany({ serverId: server._id }, { $set: { serverId: null } });
  await Subuser.deleteMany({ serverId: server._id });
  await Schedule.deleteMany({ serverId: server._id });
  const { destroyServerDatabases } = await import("./databases");
  await destroyServerDatabases(server._id);
  await destroyServerActivity(server._id);
  await Server.deleteOne({ _id: server._id });
  return { ok: true };
}

const installing = new Set<string>();

async function runInstall(serverId: string) {
  if (installing.has(serverId)) return;
  installing.add(serverId);
  try {
    const server = await Server.findById(serverId);
    if (!server) return;
    const docs = await related(server);
    if (!docs.egg || !docs.allocation) {
      server.status = "install_failed";
      await server.save();
      return;
    }
    server.status = "installing";
    await server.save();
    await installOnNode(server.nodeId.toString(), await specFor(server, docs.egg, docs.allocation));
    const row = await Server.findById(serverId);
    if (row && (row.status === "installing" || row.status === "install_failed")) {
      row.status = "offline";
      await row.save();
    }
  } catch (error) {
    log("error", "server install failed", {
      serverId,
      error: error instanceof Error ? error.message : String(error),
    });
    const server = await Server.findById(serverId);
    if (server && server.status === "installing") {
      server.status = "install_failed";
      await server.save();
    }
  } finally {
    installing.delete(serverId);
  }
}

async function requireServer(
  serverId: string,
  viewerId: string,
  admin: boolean,
  permission: ServerPermission,
) {
  const access = await requireAccess(serverId, viewerId, admin, permission);
  if (!access.admin) {
    const node = await Node.findById(access.server.nodeId);
    if (node?.maintenanceMode) {
      throw FlutterError.unavailable("This node is in maintenance mode. Try again later.");
    }
  }
  return access.server;
}

export async function serverLogs(serverId: string, viewerId: string, admin: boolean, tail = 200) {
  const server = await requireServer(serverId, viewerId, admin, "control.console");
  try {
    const data = await logsOnNode(server.nodeId.toString(), server.uuid, tail);
    return { running: Boolean(data.running), lines: data.lines ?? [] };
  } catch {
    return { running: false, lines: [] as string[] };
  }
}

export async function serverCommand(
  serverId: string,
  viewerId: string,
  admin: boolean,
  body: unknown,
) {
  const command =
    typeof body === "object" && body && "command" in body
      ? String((body as { command: unknown }).command ?? "")
      : String(body ?? "");
  if (!command.trim()) throw FlutterError.validation("command is required");
  const shell = Boolean(typeof body === "object" && body && (body as { shell?: unknown }).shell);
  const server = await requireServer(serverId, viewerId, admin, "control.console");
  if (server.status === "installing") {
    throw FlutterError.conflict("Wait for install to finish before sending commands");
  }
  const live = server.status === "running" || server.status === "starting" || server.status === "stopping";
  await commandOnNode(server.nodeId.toString(), server.uuid, command.trim(), { shell: shell && !live });
  return { ok: true };
}

export async function serverFiles(
  serverId: string,
  viewerId: string,
  admin: boolean,
  body: unknown,
) {
  const parsed = (body ?? {}) as {
    action?: string;
    path?: string;
    content?: string;
    to?: string;
    name?: string;
    names?: string[];
    contentBase64?: string;
    query?: string;
  };
  const action = parsed.action || "list";
  const filePerm: Record<string, ServerPermission> = {
    list: "file.read",
    read: "file.read",
    search: "file.read",
    stat: "file.read",
    write: "file.write",
    mkdir: "file.write",
    upload: "file.write",
    rename: "file.write",
    delete: "file.delete",
    extract: "file.archive",
    compress: "file.archive",
  };
  const permission = filePerm[action];
  if (!permission) throw FlutterError.validation("Unknown file action");
  const server = await requireServer(serverId, viewerId, admin, permission);
  const node = await Node.findById(server.nodeId);
  const nodeId = server.nodeId.toString();
  let change: ReturnType<typeof fileChangePreview> | null = null;
  if (action === "write") {
    try {
      change = await fileWritePreview(nodeId, server.uuid, parsed.path, parsed.content ?? "");
    } catch {
      change = null;
    }
  }
  const result = await filesOnNode(nodeId, server.uuid, {
    action,
    path: parsed.path,
    content: parsed.content,
    to: parsed.to,
    name: parsed.name,
    names: parsed.names,
    contentBase64: parsed.contentBase64,
    maxBytes: uploadLimitBytes(node?.uploadLimitMb),
    query: parsed.query,
  });
  if (action === "write") {
    recordFileWrite({
      serverId: server._id.toString(),
      path: parsed.path,
      after: parsed.content ?? "",
      actor: userActor(viewerId),
      change,
    });
  } else if (action !== "list" && action !== "read" && action !== "search" && action !== "stat") {
    recordActivity({
      serverId: server._id.toString(),
      event: `file.${action}`,
      category: "files",
      actor: userActor(viewerId),
      properties: {
        path: parsed.path,
        to: parsed.to,
        name: parsed.name,
        names: parsed.names,
      },
    });
  }
  return result;
}

export async function downloadServerFiles(
  serverId: string,
  viewerId: string,
  admin: boolean,
  path: string,
  names: string[],
) {
  const server = await requireServer(serverId, viewerId, admin, "file.read");
  return downloadOnNode(server.nodeId.toString(), server.uuid, path || "/", names);
}

async function fileWritePreview(nodeId: string, uuid: string, path: string | undefined, content: string) {
  if (!path) return fileChangePreview(null, content);
  try {
    const prior = await filesOnNode(nodeId, uuid, { action: "read", path });
    const old =
      prior && typeof prior === "object" && "content" in prior && typeof (prior as { content?: unknown }).content === "string"
        ? (prior as { content: string }).content
        : null;
    return fileChangePreview(old, content);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/binary/i.test(message)) return null;
    return fileChangePreview(null, content);
  }
}

export async function serverBackups(
  serverId: string,
  viewerId: string,
  admin: boolean,
  body: unknown,
) {
  const parsed = (body ?? {}) as { action?: string; id?: string };
  const action = parsed.action || "list";
  const backupPerm: Record<string, ServerPermission> = {
    list: "backup.read",
    create: "backup.create",
    delete: "backup.delete",
    restore: "backup.restore",
  };
  const permission = backupPerm[action] ?? "backup.read";
  const server = await requireServer(serverId, viewerId, admin, permission);
  if ((action === "create" || action === "restore") && server.backupsEnabled === false) {
    throw FlutterError.forbidden("Backups are disabled for this server");
  }
  if (action === "restore") {
    const docs = await related(server);
    if (docs.egg && docs.allocation) {
      try {
        await powerOnNode(server.nodeId.toString(), await specFor(server, docs.egg, docs.allocation), "stop");
      } catch {
        /* already offline */
      }
    }
  }
  const result = await backupsOnNode(server.nodeId.toString(), server.uuid, {
    action,
    id: parsed.id,
  });
  if (action === "create" || action === "restore" || action === "delete") {
    const backup =
      result && typeof result === "object" && "backup" in result
        ? (result as { backup?: { id?: string; name?: string } }).backup
        : undefined;
    recordActivity({
      serverId: server._id.toString(),
      event: `backup.${action}`,
      category: "backups",
      actor: userActor(viewerId),
      properties: { name: backup?.name || backup?.id || parsed.id },
    });
  }
  return result;
}

async function listNetworkAllocations(server: {
  _id: { toString(): string };
  allocationId: { toString(): string };
  eggId: { toString(): string };
}) {
  const [rows, egg] = await Promise.all([
    Allocation.find({ serverId: server._id }).sort({ port: 1 }),
    Egg.findById(server.eggId),
  ]);
  const eggName = egg?.name ?? "";
  const eggDescription = egg?.description ?? "";
  return rows.map((row) => {
    const display = allocationDisplay(row);
    return {
      id: row._id.toString(),
      ip: row.ip,
      alias: row.alias || "",
      port: row.port,
      notes: row.notes || "",
      primary: row._id.toString() === server.allocationId.toString(),
      display,
      http: allocationIsHttp(eggName, eggDescription, row.port),
      url: allocationBrowserUrl(row),
    };
  });
}

export async function serverNetwork(serverId: string, viewerId: string, admin: boolean) {
  const server = await requireServer(serverId, viewerId, admin, "allocation.read");
  return listNetworkAllocations(server);
}

export async function updateServerAllocation(
  serverId: string,
  allocationId: string,
  viewerId: string,
  admin: boolean,
  body: unknown,
) {
  const parsed = allocationUpdateSchema.safeParse(body);
  if (!parsed.success) throw FlutterError.validation("Invalid allocation", parsed.error.flatten());
  const server = await requireServer(serverId, viewerId, admin, "allocation.update");
  if (!/^[a-fA-F0-9]{24}$/.test(allocationId)) throw FlutterError.notFound("Allocation not found");
  const row = await Allocation.findOne({ _id: allocationId, serverId: server._id });
  if (!row) throw FlutterError.notFound("Allocation not found");

  const fields: string[] = [];
  if (parsed.data.notes !== undefined) {
    const notes = parsed.data.notes.trim();
    if (notes !== (row.notes || "")) {
      row.notes = notes;
      fields.push("notes");
    }
  }
  if (parsed.data.alias !== undefined) {
    const alias = parsed.data.alias.trim();
    if (alias !== (row.alias || "")) {
      row.alias = alias;
      fields.push("alias");
    }
  }
  if (fields.length) await row.save();

  let madePrimary = false;
  if (parsed.data.primary && row._id.toString() !== server.allocationId.toString()) {
    server.allocationId = row._id;
    await server.save();
    madePrimary = true;
  }

  const display = allocationDisplay(row);
  if (madePrimary) {
    recordActivity({
      serverId: server._id.toString(),
      event: "allocation.primary",
      category: "network",
      actor: userActor(viewerId),
      properties: { name: display },
    });
  } else if (fields.length) {
    recordActivity({
      serverId: server._id.toString(),
      event: "allocation.update",
      category: "network",
      actor: userActor(viewerId),
      properties: { name: display, fields },
    });
  }

  return listNetworkAllocations(server);
}

export async function consoleSocket(
  serverId: string,
  viewerId: string,
  admin: boolean,
  requestOrigin?: string,
) {
  const server = await requireServer(serverId, viewerId, admin, "control.console");
  const token = signConsoleTicket(env().SESSION_SECRET, {
    serverId: server._id.toString(),
    uuid: server.uuid,
    nodeId: server.nodeId.toString(),
    userId: viewerId,
  });
  return { token, socket: consoleWsUrl(requestOrigin) };
}

export async function applyPowerDirect(serverId: string, action: PowerAction) {
  const server = await Server.findById(serverId);
  if (!server) throw FlutterError.notFound("Server not found");
  if (server.status === "installing") {
    throw FlutterError.conflict("Wait for install to finish before sending power actions");
  }
  const docs = await related(server);
  if (!docs.egg || !docs.allocation) throw FlutterError.notFound("Server is missing egg or allocation");
  if (!isNodeOnline(docs.node?.lastHeartbeatAt) || !docs.node?.daemonListenUrl) {
    throw FlutterError.unavailable("Node daemon is offline");
  }
  server.status = action === "start" || action === "restart" ? "starting" : "stopping";
  await server.save();
  try {
    await powerOnNode(server.nodeId.toString(), await specFor(server, docs.egg, docs.allocation), action);
    recordActivity({
      serverId: server._id.toString(),
      event: `power.${action}`,
      category: "power",
    });
  } catch (error) {
    const row = await Server.findById(serverId);
    if (row && row.status !== "installing" && row.status !== "install_failed") {
      if (row.status === "starting" || row.status === "stopping") {
        row.status = "offline";
        await row.save();
      }
    }
    throw error;
  }
}

export async function sendCommandDirect(serverId: string, command: string) {
  const server = await Server.findById(serverId);
  if (!server) throw FlutterError.notFound("Server not found");
  await commandOnNode(server.nodeId.toString(), server.uuid, command.trim());
}

export async function createBackupDirect(serverId: string) {
  const server = await Server.findById(serverId);
  if (!server) throw FlutterError.notFound("Server not found");
  if (server.backupsEnabled === false) {
    throw FlutterError.forbidden("Backups are disabled for this server");
  }
  const result = await backupsOnNode(server.nodeId.toString(), server.uuid, { action: "create" });
  const backup =
    result && typeof result === "object" && "backup" in result
      ? (result as { backup?: { id?: string; name?: string } }).backup
      : undefined;
  recordActivity({
    serverId: server._id.toString(),
    event: "backup.create",
    category: "backups",
    properties: { name: backup?.name || backup?.id },
  });
  return result;
}
