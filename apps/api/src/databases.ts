import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import {
  FlutterError,
  databaseHostCreateSchema,
  databaseHostTestSchema,
  databaseHostUpdateSchema,
  serverDatabaseCreateSchema,
} from "@flutter-software/shared";
import { DatabaseHost, Node, Server, ServerDatabase } from "./db/models";
import { requireAccess } from "./servers";
import { recordActivity } from "./activity";

type HostRow = {
  _id: { toString(): string };
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  publicHost?: string;
  publicPort?: number;
  nodeIds?: { toString(): string }[];
  maxDatabases?: number;
  createdAt?: Date;
};

function ident(value: string) {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) {
    throw FlutterError.validation("Invalid database identifier");
  }
  return `\`${value}\``;
}

function quoteRemote(value: string) {
  if (!/^[a-zA-Z0-9._%\-:]+$/.test(value)) {
    throw FlutterError.validation("Invalid remote host");
  }
  return `'${value}'`;
}

function randomPassword() {
  return randomBytes(18).toString("base64url");
}

function serverPrefix(uuid: string) {
  return uuid.replace(/-/g, "").slice(0, 8).toLowerCase();
}

function clip(value: string, max: number) {
  return value.length <= max ? value : value.slice(0, max);
}

function mysqlMessage(error: unknown) {
  if (error instanceof FlutterError) return error.message;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error);
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ENOTFOUND") {
    return "Could not reach the database host. Check the hostname, port, and firewall.";
  }
  if (code === "ER_ACCESS_DENIED_ERROR") {
    return "Database host username or password was rejected.";
  }
  if (code === "ER_DBACCESS_DENIED_ERROR" || code === "ER_SPECIFIC_ACCESS_DENIED_ERROR") {
    return "This MySQL user cannot create databases or users. Grant CREATE, CREATE USER, and GRANT OPTION.";
  }
  return message.replace(/^Error:\s*/i, "");
}

async function withHost<T>(host: HostRow, action: (conn: mysql.Connection) => Promise<T>) {
  let conn: mysql.Connection | undefined;
  try {
    conn = await mysql.createConnection({
      host: host.host,
      port: Number(host.port) || 3306,
      user: host.username,
      password: host.password,
      connectTimeout: 8_000,
      multipleStatements: false,
    });
    return await action(conn);
  } catch (error) {
    if (error instanceof FlutterError) throw error;
    throw FlutterError.unavailable(mysqlMessage(error));
  } finally {
    await conn?.end().catch(() => undefined);
  }
}

function publicEndpoint(host: HostRow) {
  const hostname = host.publicHost?.trim() || host.host;
  const port = Number(host.publicPort) > 0 ? Number(host.publicPort) : Number(host.port) || 3306;
  return { host: hostname, port };
}

function toHost(
  row: HostRow,
  extras: { databaseCount?: number; nodeNames?: string[] } = {},
) {
  const endpoint = publicEndpoint(row);
  return {
    id: row._id.toString(),
    name: row.name,
    host: row.host,
    port: Number(row.port) || 3306,
    username: row.username,
    passwordSet: Boolean(row.password),
    publicHost: row.publicHost ?? "",
    publicPort: Number(row.publicPort) || 0,
    nodeIds: (row.nodeIds ?? []).map((id) => id.toString()),
    nodeNames: extras.nodeNames ?? [],
    maxDatabases: Number(row.maxDatabases) || 0,
    databaseCount: extras.databaseCount ?? 0,
    endpoint,
    createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
  };
}

function toDatabase(
  row: {
    _id: { toString(): string };
    name: string;
    database: string;
    username: string;
    password: string;
    remote: string;
    createdAt?: Date;
  },
  host: HostRow,
) {
  const endpoint = publicEndpoint(host);
  return {
    id: row._id.toString(),
    hostId: host._id.toString(),
    hostName: host.name,
    name: row.name,
    database: row.database,
    username: row.username,
    password: row.password,
    remote: row.remote,
    host: endpoint.host,
    port: endpoint.port,
    jdbc: `jdbc:mysql://${endpoint.host}:${endpoint.port}/${row.database}`,
    createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
  };
}

async function loadHost(id: string) {
  const row = await DatabaseHost.findById(id);
  if (!row) throw FlutterError.notFound("Database host not found");
  return row as unknown as HostRow & { save: () => Promise<unknown> };
}

function hostAllowsNode(host: HostRow, nodeId: string) {
  const ids = (host.nodeIds ?? []).map((id) => id.toString());
  return ids.length === 0 || ids.includes(nodeId);
}

export async function listHosts() {
  const [hosts, nodes, counts] = await Promise.all([
    DatabaseHost.find().sort({ name: 1 }),
    Node.find({}, { name: 1 }),
    ServerDatabase.aggregate<{ _id: unknown; count: number }>([
      { $group: { _id: "$hostId", count: { $sum: 1 } } },
    ]),
  ]);
  const nodeName = new Map(nodes.map((node) => [node._id.toString(), node.name]));
  const countByHost = new Map(counts.map((row) => [String(row._id), row.count]));
  return hosts.map((host) => {
    const ids: string[] = (host.nodeIds ?? []).map((nodeId: { toString(): string }) => nodeId.toString());
    return toHost(host as unknown as HostRow, {
      databaseCount: countByHost.get(host._id.toString()) ?? 0,
      nodeNames: ids.map((id) => nodeName.get(id) ?? "Unknown node"),
    });
  });
}

export async function getHost(id: string) {
  const host = await loadHost(id);
  const [databaseCount, nodes] = await Promise.all([
    ServerDatabase.countDocuments({ hostId: host._id }),
    Node.find({ _id: { $in: host.nodeIds ?? [] } }, { name: 1 }),
  ]);
  return toHost(host, {
    databaseCount,
    nodeNames: nodes.map((node) => node.name),
  });
}

export async function createHost(body: unknown) {
  const parsed = databaseHostCreateSchema.safeParse(body);
  if (!parsed.success) throw FlutterError.validation("Invalid database host", parsed.error.flatten());
  if (parsed.data.nodeIds?.length) {
    const count = await Node.countDocuments({ _id: { $in: parsed.data.nodeIds } });
    if (count !== parsed.data.nodeIds.length) throw FlutterError.validation("One or more nodes were not found");
  }
  const row = await DatabaseHost.create({
    name: parsed.data.name,
    host: parsed.data.host,
    port: parsed.data.port,
    username: parsed.data.username,
    password: parsed.data.password,
    publicHost: parsed.data.publicHost ?? "",
    publicPort: parsed.data.publicPort ?? 0,
    nodeIds: parsed.data.nodeIds ?? [],
    maxDatabases: parsed.data.maxDatabases ?? 0,
  });
  return getHost(row._id.toString());
}

export async function updateHost(id: string, body: unknown) {
  const parsed = databaseHostUpdateSchema.safeParse(body);
  if (!parsed.success) throw FlutterError.validation("Invalid database host", parsed.error.flatten());
  const host = await loadHost(id);
  if (parsed.data.name !== undefined) host.name = parsed.data.name;
  if (parsed.data.host !== undefined) host.host = parsed.data.host;
  if (parsed.data.port !== undefined) host.port = parsed.data.port;
  if (parsed.data.username !== undefined) host.username = parsed.data.username;
  if (parsed.data.password) host.password = parsed.data.password;
  if (parsed.data.publicHost !== undefined) host.publicHost = parsed.data.publicHost;
  if (parsed.data.publicPort !== undefined) host.publicPort = parsed.data.publicPort;
  if (parsed.data.maxDatabases !== undefined) host.maxDatabases = parsed.data.maxDatabases;
  if (parsed.data.nodeIds !== undefined) {
    if (parsed.data.nodeIds.length) {
      const count = await Node.countDocuments({ _id: { $in: parsed.data.nodeIds } });
      if (count !== parsed.data.nodeIds.length) throw FlutterError.validation("One or more nodes were not found");
    }
    (host as unknown as { nodeIds: string[] }).nodeIds = parsed.data.nodeIds;
  }
  await host.save();
  return getHost(id);
}

export async function deleteHost(id: string) {
  const count = await ServerDatabase.countDocuments({ hostId: id });
  if (count > 0) {
    throw FlutterError.conflict("Delete the databases on this host before removing it.");
  }
  const row = await DatabaseHost.findByIdAndDelete(id);
  if (!row) throw FlutterError.notFound("Database host not found");
  return { ok: true };
}

async function mysqlVersion(host: HostRow) {
  return withHost(host, async (conn) => {
    const [rows] = await conn.query("SELECT VERSION() AS version");
    const list = Array.isArray(rows) ? rows : [];
    const first = list[0] as { version?: string } | undefined;
    return first?.version || "ok";
  });
}

export async function testHost(id: string) {
  const host = await loadHost(id);
  return { ok: true, version: await mysqlVersion(host) };
}

export async function testConnection(body: unknown) {
  const parsed = databaseHostTestSchema.safeParse(body);
  if (!parsed.success) throw FlutterError.validation("Invalid database host", parsed.error.flatten());
  let password = parsed.data.password ?? "";
  if (!password && parsed.data.hostId) {
    const stored = await loadHost(parsed.data.hostId);
    password = stored.password;
  }
  if (!password) throw FlutterError.validation("Password is required to test the connection");
  const version = await mysqlVersion({
    _id: { toString: () => parsed.data.hostId ?? "test" },
    name: "test",
    host: parsed.data.host,
    port: parsed.data.port,
    username: parsed.data.username,
    password,
  });
  return { ok: true, version };
}

async function hostsForServer(nodeId: string) {
  const hosts = (await DatabaseHost.find().sort({ name: 1 })) as unknown as HostRow[];
  const eligible = hosts.filter((host) => hostAllowsNode(host, nodeId));
  if (!eligible.length) return [];
  const counts = await ServerDatabase.aggregate<{ _id: unknown; count: number }>([
    { $match: { hostId: { $in: eligible.map((host) => host._id) } } },
    { $group: { _id: "$hostId", count: { $sum: 1 } } },
  ]);
  const countByHost = new Map(counts.map((row) => [String(row._id), row.count]));
  return eligible.map((host) => {
    const used = countByHost.get(host._id.toString()) ?? 0;
    const max = Number(host.maxDatabases) || 0;
    return {
      ...toHost(host, { databaseCount: used }),
      available: max === 0 || used < max,
    };
  });
}

export async function listServerDatabases(serverId: string, viewerId: string, admin: boolean) {
  const access = await requireAccess(serverId, viewerId, admin, "database.read");
  const server = access.server;
  const [rows, hosts] = await Promise.all([
    ServerDatabase.find({ serverId: server._id }).sort({ createdAt: 1 }),
    hostsForServer(server.nodeId.toString()),
  ]);
  const hostById = new Map<string, ReturnType<typeof toHost> & { available?: boolean }>(
    hosts.map((host) => [host.id, host]),
  );
  const missing = await DatabaseHost.find({
    _id: { $in: rows.map((row) => row.hostId).filter((id) => !hostById.has(id.toString())) },
  });
  for (const host of missing) hostById.set(host._id.toString(), toHost(host as unknown as HostRow));
  return {
    limit: Number(server.databaseLimit) || 0,
    databases: rows.map((row) => {
      const host = hostById.get(row.hostId.toString());
      if (!host) {
        return {
          id: row._id.toString(),
          hostId: row.hostId.toString(),
          hostName: "Unknown host",
          name: row.name,
          database: row.database,
          username: row.username,
          password: row.password,
          remote: row.remote,
          host: "",
          port: 3306,
          jdbc: "",
          createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
        };
      }
      return toDatabase(row, {
        _id: { toString: () => host.id },
        name: host.name,
        host: host.host,
        port: host.port,
        username: host.username,
        password: "",
        publicHost: host.publicHost,
        publicPort: host.publicPort,
      });
    }),
    hosts: hosts.filter((host) => host.available),
  };
}

export async function createServerDatabase(serverId: string, viewerId: string, admin: boolean, body: unknown) {
  const access = await requireAccess(serverId, viewerId, admin, "database.create");
  const server = access.server;
  const limit = Number(server.databaseLimit) || 0;
  if (limit <= 0) throw FlutterError.forbidden("This server has no database slots.");
  const used = await ServerDatabase.countDocuments({ serverId: server._id });
  if (used >= limit) throw FlutterError.conflict(`This server already uses all ${limit} database slots.`);

  const parsed = serverDatabaseCreateSchema.safeParse(body);
  if (!parsed.success) throw FlutterError.validation("Invalid database", parsed.error.flatten());
  const host = await loadHost(parsed.data.hostId);
  if (!hostAllowsNode(host, server.nodeId.toString())) {
    throw FlutterError.forbidden("That database host is not available on this node.");
  }
  const max = Number(host.maxDatabases) || 0;
  if (max > 0) {
    const hostUsed = await ServerDatabase.countDocuments({ hostId: host._id });
    if (hostUsed >= max) throw FlutterError.conflict("This database host is full.");
  }

  const prefix = serverPrefix(server.uuid);
  const database = clip(`s${prefix}_${parsed.data.name}`, 64);
  const username = clip(`u${prefix}_${parsed.data.name}`, 32);
  const password = randomPassword();
  const remote = parsed.data.remote || "%";

  const existing = await ServerDatabase.findOne({
    $or: [{ database }, { username }, { serverId: server._id, name: parsed.data.name }],
  });
  if (existing) throw FlutterError.conflict("A database with that name already exists.");

  await withHost(host, async (conn) => {
    await conn.query(`CREATE DATABASE ${ident(database)}`);
    try {
      await conn.query(`CREATE USER ${ident(username)}@${quoteRemote(remote)} IDENTIFIED BY ?`, [password]);
      await conn.query(
        `GRANT ALL PRIVILEGES ON ${ident(database)}.* TO ${ident(username)}@${quoteRemote(remote)}`,
      );
      await conn.query("FLUSH PRIVILEGES");
    } catch (error) {
      await conn.query(`DROP DATABASE IF EXISTS ${ident(database)}`).catch(() => undefined);
      await conn.query(`DROP USER IF EXISTS ${ident(username)}@${quoteRemote(remote)}`).catch(() => undefined);
      throw error;
    }
  });

  try {
    const row = await ServerDatabase.create({
      serverId: server._id,
      hostId: host._id,
      name: parsed.data.name,
      database,
      username,
      password,
      remote,
    });
    recordActivity({
      serverId: server._id.toString(),
      event: "database.create",
      category: "databases",
      properties: { name: parsed.data.name, database },
    });
    return toDatabase(row, host);
  } catch (error) {
    await withHost(host, async (conn) => {
      await conn.query(`DROP DATABASE IF EXISTS ${ident(database)}`).catch(() => undefined);
      await conn.query(`DROP USER IF EXISTS ${ident(username)}@${quoteRemote(remote)}`).catch(() => undefined);
    }).catch(() => undefined);
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      throw FlutterError.conflict("A database with that name already exists.");
    }
    throw error;
  }
}

async function loadServerDatabase(serverId: string, databaseId: string, viewerId: string, admin: boolean, permission: "database.read" | "database.update" | "database.delete") {
  const access = await requireAccess(serverId, viewerId, admin, permission);
  const row = await ServerDatabase.findOne({ _id: databaseId, serverId: access.server._id });
  if (!row) throw FlutterError.notFound("Database not found");
  const host = await DatabaseHost.findById(row.hostId);
  return { row, host: host as unknown as HostRow | null, server: access.server };
}

export async function rotateServerDatabase(serverId: string, databaseId: string, viewerId: string, admin: boolean) {
  const { row, host } = await loadServerDatabase(serverId, databaseId, viewerId, admin, "database.update");
  if (!host) throw FlutterError.unavailable("The database host is missing.");
  const password = randomPassword();
  await withHost(host, async (conn) => {
    await conn.query(`ALTER USER ${ident(row.username)}@${quoteRemote(row.remote)} IDENTIFIED BY ?`, [password]);
    await conn.query("FLUSH PRIVILEGES");
  });
  row.password = password;
  await row.save();
  recordActivity({
    serverId: serverId,
    event: "database.rotate",
    category: "databases",
    properties: { name: row.name, database: row.database },
  });
  return toDatabase(row, host);
}

export async function deleteServerDatabase(serverId: string, databaseId: string, viewerId: string, admin: boolean) {
  const { row, host } = await loadServerDatabase(serverId, databaseId, viewerId, admin, "database.delete");
  if (host) {
    await withHost(host, async (conn) => {
      await conn.query(`DROP DATABASE IF EXISTS ${ident(row.database)}`);
      await conn.query(`DROP USER IF EXISTS ${ident(row.username)}@${quoteRemote(row.remote)}`);
      await conn.query("FLUSH PRIVILEGES");
    });
  }
  const name = row.name;
  const database = row.database;
  await ServerDatabase.deleteOne({ _id: row._id });
  recordActivity({
    serverId,
    event: "database.delete",
    category: "databases",
    properties: { name, database },
  });
  return { ok: true };
}

export async function destroyServerDatabases(serverId: { toString(): string }) {
  const rows = await ServerDatabase.find({ serverId });
  for (const row of rows) {
    const host = await DatabaseHost.findById(row.hostId);
    if (!host) continue;
    await withHost(host as unknown as HostRow, async (conn) => {
      await conn.query(`DROP DATABASE IF EXISTS ${ident(row.database)}`).catch(() => undefined);
      await conn.query(`DROP USER IF EXISTS ${ident(row.username)}@${quoteRemote(row.remote)}`).catch(() => undefined);
    }).catch(() => undefined);
  }
  await ServerDatabase.deleteMany({ serverId });
}
