import {
  FlutterError,
  allocationCreateSchema,
  locationCreateSchema,
  locationUpdateSchema,
  nodeCreateSchema,
  nodeUpdateSchema,
  parsePortSpec,
} from "@flutter-software/shared";
import { Allocation, Location, Node, Server } from "../db/models";
import { hashPassword, randomToken } from "./crypto";
import { isNodeOnline, panelApiUrl } from "../nodes";

export function parsePortsOrThrow(raw: string): number[] {
  const parsed = parsePortSpec(raw);
  if (!parsed.ok) throw FlutterError.validation(parsed.error);
  return parsed.ports;
}

export async function listLocations() {
  const [rows, nodes] = await Promise.all([
    Location.find().sort({ shortCode: 1 }),
    Node.find({}, { locationId: 1 }),
  ]);
  const countByLocation = new Map<string, number>();
  for (const node of nodes) {
    const key = node.locationId.toString();
    countByLocation.set(key, (countByLocation.get(key) ?? 0) + 1);
  }
  return rows.map((row) => toLocation(row, countByLocation.get(row._id.toString()) ?? 0));
}

function toLocation(row: { _id: { toString(): string }; shortCode: string; description?: string; createdAt: Date }, nodeCount = 0) {
  return {
    id: row._id.toString(),
    shortCode: row.shortCode,
    description: row.description ?? "",
    createdAt: row.createdAt,
    nodeCount,
  };
}

function isDuplicateKeyError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: unknown }).code === 11000,
  );
}

export async function createLocation(body: unknown) {
  const parsed = locationCreateSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Invalid location", parsed.error.flatten());
  }
  try {
    const row = await Location.create({
      shortCode: parsed.data.shortCode.trim().toLowerCase(),
      description: parsed.data.description ?? "",
    });
    return toLocation(row);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw FlutterError.conflict("Location short code already exists");
    }
    throw error;
  }
}

export async function getLocation(id: string) {
  const row = await Location.findById(id);
  if (!row) throw FlutterError.notFound("Location not found");
  const nodeCount = await Node.countDocuments({ locationId: id });
  return toLocation(row, nodeCount);
}

export async function updateLocation(id: string, body: unknown) {
  const parsed = locationUpdateSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Invalid location", parsed.error.flatten());
  }
  const row = await Location.findById(id);
  if (!row) throw FlutterError.notFound("Location not found");
  try {
    if (parsed.data.shortCode) row.shortCode = parsed.data.shortCode.trim().toLowerCase();
    if (parsed.data.description !== undefined) row.description = parsed.data.description;
    await row.save();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw FlutterError.conflict("Location short code already exists");
    }
    throw error;
  }
  const nodeCount = await Node.countDocuments({ locationId: id });
  return toLocation(row, nodeCount);
}

export async function deleteLocation(id: string) {
  const row = await Location.findById(id);
  if (!row) throw FlutterError.notFound("Location not found");
  const nodes = await Node.countDocuments({ locationId: id });
  if (nodes > 0) {
    throw FlutterError.conflict("Move or delete nodes in this location first");
  }
  await Location.deleteOne({ _id: id });
  return { deleted: true };
}

function nodeBase(node: {
  _id: { toString(): string };
  locationId: { toString(): string };
  name: string;
  description?: string;
  fqdn: string;
  public?: boolean;
  scheme?: string;
  behindProxy?: boolean;
  daemonBase?: string;
  memoryMb: number;
  diskMb: number;
  cpuCores?: number;
  memoryOverallocate?: number;
  diskOverallocate?: number;
  daemonPort?: number;
  sftpPort?: number;
  uploadLimitMb?: number;
  maintenanceMode?: boolean;
  daemonVersion?: string | null;
  systemHostname?: string | null;
  systemPlatform?: string | null;
  systemRelease?: string | null;
  systemArch?: string | null;
  systemCpuThreads?: number;
  systemTotalMemoryMb?: number;
  daemonToken?: string | null;
  tokenPrefix?: string | null;
  daemonListenUrl?: string | null;
  lastHeartbeatAt?: Date | null;
  createdAt: Date;
}) {
  return {
    id: node._id.toString(),
    locationId: node.locationId.toString(),
    name: node.name,
    description: node.description ?? "",
    fqdn: node.fqdn,
    public: node.public !== false,
    scheme: node.scheme === "http" ? "http" : "https",
    behindProxy: Boolean(node.behindProxy),
    daemonBase: node.daemonBase || "/var/lib/flutter/volumes",
    memoryMb: node.memoryMb,
    diskMb: node.diskMb,
    cpuCores: Number(node.cpuCores) || 0,
    memoryOverallocate: Number(node.memoryOverallocate) || 0,
    diskOverallocate: Number(node.diskOverallocate) || 0,
    daemonPort: Number(node.daemonPort) || 8080,
    sftpPort: Number(node.sftpPort) || 2022,
    uploadLimitMb: Number(node.uploadLimitMb) > 0 ? Number(node.uploadLimitMb) : 250,
    maintenanceMode: Boolean(node.maintenanceMode),
    daemonVersion: node.daemonVersion || null,
    system: {
      hostname: node.systemHostname || null,
      platform: node.systemPlatform || null,
      release: node.systemRelease || null,
      arch: node.systemArch || null,
      cpuThreads: Number(node.systemCpuThreads) || 0,
      totalMemoryMb: Number(node.systemTotalMemoryMb) || 0,
    },
    tokenPrefix: node.daemonToken
      ? String(node.daemonToken).slice(0, 12)
      : node.tokenPrefix ?? null,
    daemonListenUrl: node.daemonListenUrl ?? null,
    lastHeartbeatAt: node.lastHeartbeatAt ?? null,
    createdAt: node.createdAt,
    online: isNodeOnline(node.lastHeartbeatAt),
  };
}

export async function listNodes() {
  const [rows, locations, allocations, servers] = await Promise.all([
    Node.find().sort({ name: 1 }),
    Location.find(),
    Allocation.find().sort({ ip: 1, port: 1 }),
    Server.find({}, { nodeId: 1, memoryMb: 1, diskMb: 1, name: 1, status: 1, allocationId: 1 }),
  ]);
  const locationById = new Map(locations.map((row) => [row._id.toString(), row.shortCode]));
  const allocByNode = new Map<string, typeof allocations>();
  for (const row of allocations) {
    const key = row.nodeId.toString();
    const list = allocByNode.get(key) ?? [];
    list.push(row);
    allocByNode.set(key, list);
  }
  const memoryByNode = new Map<string, number>();
  const diskByNode = new Map<string, number>();
  const countByNode = new Map<string, number>();
  for (const server of servers) {
    const key = server.nodeId.toString();
    memoryByNode.set(key, (memoryByNode.get(key) ?? 0) + server.memoryMb);
    diskByNode.set(key, (diskByNode.get(key) ?? 0) + server.diskMb);
    countByNode.set(key, (countByNode.get(key) ?? 0) + 1);
  }
  const serverNameById = new Map(servers.map((row) => [row._id.toString(), row.name]));

  return rows.map((node) => {
    const id = node._id.toString();
    const ports = allocByNode.get(id) ?? [];
    return {
      ...nodeBase(node),
      location: locationById.get(node.locationId.toString()) ?? "",
      memoryCommittedMb: memoryByNode.get(id) ?? 0,
      diskCommittedMb: diskByNode.get(id) ?? 0,
      serverCount: countByNode.get(id) ?? 0,
      allocations: ports.map((row) => {
        const serverId = row.serverId ? row.serverId.toString() : null;
        return {
          id: row._id.toString(),
          ip: row.ip,
          port: row.port,
          alias: row.alias ?? "",
          notes: row.notes ?? "",
          assigned: Boolean(row.serverId),
          serverId,
          serverName: serverId ? serverNameById.get(serverId) ?? "Unknown" : null,
        };
      }),
    };
  });
}

export async function getNode(id: string) {
  const [nodes, servers] = await Promise.all([
    listNodes(),
    Server.find({ nodeId: id }).sort({ name: 1 }),
  ]);
  const node = nodes.find((row) => row.id === id);
  if (!node) throw FlutterError.notFound("Node not found");
  const allocationById = new Map(node.allocations.map((row) => [row.id, row]));
  return {
    ...node,
    servers: servers.map((row) => {
      const allocation = node.allocations.find((item) => item.serverId === row._id.toString());
      const assigned = allocationById.get(row.allocationId?.toString() ?? "");
      return {
        id: row._id.toString(),
        name: row.name,
        uuid: row.uuid,
        status: row.status,
        memoryMb: row.memoryMb,
        diskMb: row.diskMb,
        cpuPercent: row.cpuPercent,
        allocation: assigned
          ? `${assigned.ip}:${assigned.port}`
          : allocation
            ? `${allocation.ip}:${allocation.port}`
            : "unassigned",
      };
    }),
  };
}

export async function createNode(body: unknown) {
  const parsed = nodeCreateSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Invalid node", parsed.error.flatten());
  }
  const location = await Location.findById(parsed.data.locationId);
  if (!location) throw FlutterError.notFound("Location not found");

  const token = `flt_${randomToken(24)}`;
  const row = await Node.create({
    locationId: parsed.data.locationId,
    name: parsed.data.name,
    description: parsed.data.description ?? "",
    fqdn: parsed.data.fqdn,
    public: parsed.data.public,
    scheme: parsed.data.scheme,
    behindProxy: parsed.data.behindProxy,
    daemonBase: parsed.data.daemonBase,
    memoryMb: parsed.data.memoryMb,
    diskMb: parsed.data.diskMb,
    cpuCores: parsed.data.cpuCores,
    memoryOverallocate: parsed.data.memoryOverallocate,
    diskOverallocate: parsed.data.diskOverallocate,
    daemonPort: parsed.data.daemonPort,
    sftpPort: parsed.data.sftpPort,
    uploadLimitMb: parsed.data.uploadLimitMb,
    maintenanceMode: parsed.data.maintenanceMode,
    tokenHash: await hashPassword(token),
    tokenPrefix: token.slice(0, 12),
    daemonToken: token,
  });

  const nodeId = row._id.toString();
  const panelUrl = panelApiUrl();

  return {
    node: {
      id: nodeId,
      locationId: row.locationId.toString(),
      name: row.name,
      fqdn: row.fqdn,
      memoryMb: row.memoryMb,
      diskMb: row.diskMb,
      createdAt: row.createdAt,
    },
    token,
    configure:
      process.env.NODE_ENV === "production"
        ? `curl -fsSL https://raw.githubusercontent.com/Flutter-Software/Flutter-Panel/main/install/ubuntu-node.sh | sudo bash -s -- --panel-url ${panelUrl} --token ${token} --node ${nodeId} --listen-url http://<this-server-public-ip>:8080`
        : `npm run daemon:configure -- --panel-url ${panelUrl} --token ${token} --node ${nodeId}`,
    start:
      process.env.NODE_ENV === "production"
        ? "sudo systemctl enable --now flutter-daemon"
        : "npm run dev:daemon",
  };
}

export async function updateNode(id: string, body: unknown) {
  const parsed = nodeUpdateSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Invalid node", parsed.error.flatten());
  }
  const node = await Node.findById(id);
  if (!node) throw FlutterError.notFound("Node not found");
  if (parsed.data.locationId) {
    const location = await Location.findById(parsed.data.locationId);
    if (!location) throw FlutterError.notFound("Location not found");
    node.locationId = parsed.data.locationId;
  }
  if (parsed.data.name !== undefined) node.name = parsed.data.name;
  if (parsed.data.description !== undefined) node.description = parsed.data.description;
  if (parsed.data.public !== undefined) node.public = parsed.data.public;
  if (parsed.data.fqdn !== undefined) node.fqdn = parsed.data.fqdn;
  if (parsed.data.scheme !== undefined) node.scheme = parsed.data.scheme;
  if (parsed.data.behindProxy !== undefined) node.behindProxy = parsed.data.behindProxy;
  if (parsed.data.daemonBase !== undefined) node.daemonBase = parsed.data.daemonBase;
  if (parsed.data.memoryMb !== undefined) node.memoryMb = parsed.data.memoryMb;
  if (parsed.data.diskMb !== undefined) node.diskMb = parsed.data.diskMb;
  if (parsed.data.cpuCores !== undefined) node.cpuCores = parsed.data.cpuCores;
  if (parsed.data.memoryOverallocate !== undefined) node.memoryOverallocate = parsed.data.memoryOverallocate;
  if (parsed.data.diskOverallocate !== undefined) node.diskOverallocate = parsed.data.diskOverallocate;
  if (parsed.data.daemonPort !== undefined) node.daemonPort = parsed.data.daemonPort;
  if (parsed.data.sftpPort !== undefined) node.sftpPort = parsed.data.sftpPort;
  if (parsed.data.uploadLimitMb !== undefined) node.uploadLimitMb = parsed.data.uploadLimitMb;
  if (parsed.data.maintenanceMode !== undefined) node.maintenanceMode = parsed.data.maintenanceMode;
  await node.save();
  return getNode(id);
}

export async function listAllocations(nodeId: string) {
  const node = await getNode(nodeId);
  return node.allocations;
}

export async function createAllocations(nodeId: string, body: unknown) {
  const node = await Node.findById(nodeId);
  if (!node) throw FlutterError.notFound("Node not found");
  const parsed = allocationCreateSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Invalid allocation", parsed.error.flatten());
  }
  const ports = parsePortsOrThrow(parsed.data.ports);
  const ip = parsed.data.ip.trim();
  const alias = parsed.data.alias?.trim() ?? "";
  const notes = parsed.data.notes?.trim() ?? "";
  try {
    await Allocation.insertMany(
      ports.map((port) => ({ nodeId, ip, alias, notes, port })),
      { ordered: false },
    );
  } catch {
    // Duplicate IP:port pairs are skipped; we return whatever exists for this request.
  }
  const rows = await Allocation.find({ nodeId, ip, port: { $in: ports } }).sort({ port: 1 });
  if (!rows.length) {
    throw FlutterError.conflict("Those IP:port pairs already exist");
  }
  return rows.map((row) => ({
    id: row._id.toString(),
    nodeId: row.nodeId.toString(),
    ip: row.ip,
    port: row.port,
    assigned: Boolean(row.serverId),
  }));
}

export async function deleteAllocation(nodeId: string, allocationId: string) {
  const node = await Node.findById(nodeId);
  if (!node) throw FlutterError.notFound("Node not found");
  const row = await Allocation.findOne({ _id: allocationId, nodeId });
  if (!row) throw FlutterError.notFound("Allocation not found");
  if (row.serverId) {
    throw FlutterError.conflict("Unassign or delete the server using this allocation first");
  }
  await Allocation.deleteOne({ _id: allocationId });
  return { deleted: true };
}

export async function deleteNode(id: string) {
  const node = await Node.findById(id);
  if (!node) throw FlutterError.notFound("Node not found");
  const servers = await Server.countDocuments({ nodeId: id });
  if (servers > 0) {
    throw FlutterError.conflict("Move or delete servers on this node first");
  }
  await Allocation.deleteMany({ nodeId: id });
  await Node.deleteOne({ _id: id });
  return { deleted: true };
}

export async function revealDaemonToken(id: string) {
  const node = await Node.findById(id);
  if (!node) throw FlutterError.notFound("Node not found");
  if (node.daemonToken) {
    const token = String(node.daemonToken);
    const panelUrl = panelApiUrl();
    return {
      token,
      preview: token.slice(0, 12),
      configure:
        process.env.NODE_ENV === "production"
          ? `curl -fsSL https://raw.githubusercontent.com/Flutter-Software/Flutter-Panel/main/install/ubuntu-node.sh | sudo bash -s -- --panel-url ${panelUrl} --token ${token} --node ${id} --listen-url http://<this-server-public-ip>:8080`
          : `npm run daemon:configure -- --panel-url ${panelUrl} --token ${token} --node ${id}`,
      start:
        process.env.NODE_ENV === "production"
          ? "sudo systemctl enable --now flutter-daemon"
          : "npm run dev:daemon",
    };
  }
  throw FlutterError.conflict(
    "No daemon token stored on this node. Recreate the node or wait for the daemon to heartbeat once.",
  );
}
