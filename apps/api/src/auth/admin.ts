import {
  FlutterError,
  allocationCreateSchema,
  locationCreateSchema,
  locationUpdateSchema,
  nodeCreateSchema,
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

export async function listNodes() {
  const [rows, locations, allocations, servers] = await Promise.all([
    Node.find().sort({ name: 1 }),
    Location.find(),
    Allocation.find().sort({ ip: 1, port: 1 }),
    Server.find({}, { nodeId: 1, memoryMb: 1 }),
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
  for (const server of servers) {
    const key = server.nodeId.toString();
    memoryByNode.set(key, (memoryByNode.get(key) ?? 0) + server.memoryMb);
  }

  return rows.map((node) => {
    const id = node._id.toString();
    const ports = allocByNode.get(id) ?? [];
    return {
      id,
      locationId: node.locationId.toString(),
      location: locationById.get(node.locationId.toString()) ?? "",
      name: node.name,
      description: node.description ?? "",
      fqdn: node.fqdn,
      memoryMb: node.memoryMb,
      diskMb: node.diskMb,
      memoryCommittedMb: memoryByNode.get(id) ?? 0,
      tokenPrefix: node.daemonToken
        ? String(node.daemonToken).slice(0, 12)
        : node.tokenPrefix ?? null,
      daemonListenUrl: node.daemonListenUrl,
      lastHeartbeatAt: node.lastHeartbeatAt,
      createdAt: node.createdAt,
      online: isNodeOnline(node.lastHeartbeatAt),
      allocations: ports.map((row) => ({
        id: row._id.toString(),
        ip: row.ip,
        port: row.port,
        assigned: Boolean(row.serverId),
      })),
    };
  });
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
    memoryOverallocate: parsed.data.memoryOverallocate,
    diskOverallocate: parsed.data.diskOverallocate,
    daemonPort: parsed.data.daemonPort,
    sftpPort: parsed.data.sftpPort,
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
    configure: `npm run daemon:configure -- --panel-url ${panelUrl} --token ${token} --node ${nodeId}`,
    start: "npm run dev:daemon",
  };
}

export async function listAllocations(nodeId: string) {
  const node = await Node.findById(nodeId);
  if (!node) throw FlutterError.notFound("Node not found");
  const rows = await Allocation.find({ nodeId }).sort({ ip: 1, port: 1 });
  return rows.map((row) => ({
    id: row._id.toString(),
    nodeId: row.nodeId.toString(),
    ip: row.ip,
    port: row.port,
    assigned: Boolean(row.serverId),
    serverId: row.serverId ? row.serverId.toString() : null,
  }));
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
    return { token: node.daemonToken as string, preview: String(node.daemonToken).slice(0, 12) };
  }
  throw FlutterError.conflict(
    "This node's token was shown at create and is not stored. Copy will work after the next successful heartbeat — do not reissue while the daemon is online.",
  );
}
