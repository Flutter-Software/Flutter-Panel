import {
  FlutterError,
  heartbeatSchema,
  daemonServerStateSchema,
  daemonConfigSaveSchema,
  hasServerPermission,
  lastExitSchema,
  PANEL_VERSION,
  type PowerAction,
} from "@flutter-software/shared";
import { signDaemonRequest, readBearerToken } from "@flutter-software/shared/ticket";
import { env } from "./env";
import { Node, Server, Subuser, User } from "./db/models";
import { authenticateNodeToken, isNodeOnline, panelApiUrl } from "./nodes";
import { dummyPasswordHash, verifyPassword } from "./auth/crypto";
import type { Context } from "hono";
import { recordActivity } from "./activity";

export type InstallSpec = {
  uuid: string;
  name: string;
  dockerImage: string;
  startup: string;
  stopCommand: string;
  installScript: string;
  installImage: string;
  environment: Record<string, string>;
  limits: { memoryBytes: number; diskBytes: number; cpuPercent: number; cpuPinning?: number };
  allocation: { ip: string; port: number };
  allocations?: { ip: string; port: number }[];
};

export async function configuration(c: Context) {
  const token = readBearerToken(c.req.header("authorization"));
  const nodeId = c.req.query("nodeId") ?? "";
  if (!nodeId) throw FlutterError.validation("nodeId is required");
  const node = await authenticateNodeToken(token, nodeId);
  const host = (c.req.header("x-forwarded-host") || c.req.header("host") || "").split(",")[0]?.trim();
  const proto =
    (c.req.header("x-forwarded-proto") || "").split(",")[0]?.trim() ||
    (new URL(c.req.url).protocol || "http:").replace(":", "") ||
    "http";
  const listenPort = Number(node.daemonPort) || 8080;
  return {
    panelUrl: panelApiUrl(host ? `${proto}://${host}` : undefined),
    nodeId: node._id.toString(),
    listenHost: "0.0.0.0",
    listenPort,
    sftpPort: Number(node.sftpPort) || 2022,
    // Template for `daemon:configure`. The real listenUrl is whatever the
    // operator passed (--listen-url / tunnel); heartbeat overwrites the node row.
    listenUrl: `http://127.0.0.1:${listenPort}`,
    dataDir: "./data",
    requestSecret: env().DAEMON_REQUEST_SECRET,
  };
}

export async function heartbeat(c: Context) {
  const parsed = heartbeatSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw FlutterError.validation("Invalid heartbeat", parsed.error.flatten());
  }
  const token = readBearerToken(c.req.header("authorization"));
  const node = await authenticateNodeToken(token, parsed.data.nodeId);
  node.daemonListenUrl = parsed.data.listenUrl.replace(/\/+$/, "");
  node.lastHeartbeatAt = new Date();
  if (parsed.data.version) node.daemonVersion = parsed.data.version;
  const system = parsed.data.system;
  if (system) {
    if (system.hostname) node.systemHostname = system.hostname;
    if (system.platform) node.systemPlatform = system.platform;
    if (system.release) node.systemRelease = system.release;
    if (system.arch) node.systemArch = system.arch;
    if (system.cpuThreads) node.systemCpuThreads = system.cpuThreads;
    if (system.totalMemoryMb) node.systemTotalMemoryMb = system.totalMemoryMb;
  }
  if (!node.daemonToken) {
    node.daemonToken = token;
    node.tokenPrefix = token.slice(0, 12);
  }
  await node.save();
  return {
    ok: true,
    nodeId: node._id.toString(),
    version: PANEL_VERSION,
    sftpPort: Number(node.sftpPort) || 2022,
  };
}

export async function applyServerState(c: Context, uuid: string) {
  const parsed = daemonServerStateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw FlutterError.validation("Invalid server state", parsed.error.flatten());
  }
  const token = readBearerToken(c.req.header("authorization"));
  const node = await authenticateNodeToken(token, parsed.data.nodeId);
  const server = await Server.findOne({ uuid });
  if (!server) throw FlutterError.notFound("Server not found");
  if (server.nodeId.toString() !== node._id.toString()) {
    throw FlutterError.forbidden("Server is not on this node");
  }

  if (parsed.data.lastExit !== undefined) {
    server.lastExit = parsed.data.lastExit;
    server.markModified("lastExit");
  }

  if (parsed.data.install) {
    if (server.status === "installing" || server.status === "install_failed") {
      server.status = parsed.data.install.ok ? "offline" : "install_failed";
      if (!parsed.data.install.ok && parsed.data.lastExit === undefined) {
        const fromError = lastExitSchema.safeParse({
          kind: "install_failed",
          message: parsed.data.install.error || "Install script failed",
          at: new Date().toISOString(),
        });
        if (fromError.success) {
          server.lastExit = fromError.data;
          server.markModified("lastExit");
        }
      }
      if (parsed.data.install.ok && parsed.data.lastExit === undefined) {
        server.lastExit = null;
        server.markModified("lastExit");
      }
      await server.save();
    }
    return { ok: true, status: server.status };
  }

  if (server.status === "installing" || server.status === "install_failed") {
    if (parsed.data.lastExit !== undefined) await server.save();
    return { ok: true, status: server.status };
  }

  const next = parsed.data.status;
  if (next) {
    server.status = next;
  }
  if (next || parsed.data.lastExit !== undefined) {
    await server.save();
  }
  return { ok: true, status: server.status };
}

async function daemonFetch(
  node: { _id: { toString(): string }; daemonListenUrl?: string | null; lastHeartbeatAt?: Date | null },
  spec: { uuid: string; op: string; path: string; body?: unknown; timeoutMs?: number },
) {
  if (!isNodeOnline(node.lastHeartbeatAt) || !node.daemonListenUrl) {
    throw FlutterError.unavailable("Node daemon is offline");
  }
  const timeoutMs = spec.timeoutMs ?? 60_000;
  const ticket = signDaemonRequest(env().DAEMON_REQUEST_SECRET, {
    nodeId: node._id.toString(),
    serverUuid: spec.uuid,
    op: spec.op,
    ttlMs: spec.timeoutMs ?? 60_000,
  });
  const url = `${node.daemonListenUrl.replace(/\/+$/, "")}/v1/servers/${spec.uuid}/${spec.path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ticket}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(spec.body ?? {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw FlutterError.unavailable(
      error instanceof Error ? `Daemon unreachable: ${error.message}` : "Daemon unreachable",
    );
  }

  const json = (await response.json().catch(() => null)) as
    | { ok?: boolean; data?: unknown; error?: { message?: string } }
    | null;
  if (!response.ok || json?.ok === false) {
    throw FlutterError.unavailable(json?.error?.message || `Daemon HTTP ${response.status}`);
  }
  return json?.data;
}

async function loadNode(nodeId: string) {
  const node = await Node.findById(nodeId);
  if (!node) throw FlutterError.notFound("Node not found");
  return node;
}

class ConfirmedInstallFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfirmedInstallFailure";
  }
}

export async function installOnNode(nodeId: string, spec: InstallSpec) {
  const node = await loadNode(nodeId);
  await daemonFetch(node, {
    uuid: spec.uuid,
    op: "install",
    path: "install",
    body: spec,
    timeoutMs: 30_000,
  });
  // Daemon returns as soon as the job is queued. This request stays open and
  // polls — Paper image pulls on a cold host have taken hours. The UI already
  // flipped the server to `installing` from createServer. Transient daemon
  // blips must not mark the install failed while the job is still running.
  const deadline = Date.now() + 6 * 60 * 60 * 1000;
  let lastError = "Install timed out after 6 hours";
  while (Date.now() < deadline) {
    const row = (await Server.findOne({ uuid: spec.uuid }).select("status").lean()) as {
      status?: string;
    } | null;
    if (row?.status === "offline") return { status: "ok" as const };
    if (row?.status === "install_failed") {
      throw FlutterError.unavailable("Install script failed");
    }
    try {
      const data = (await daemonFetch(node, {
        uuid: spec.uuid,
        op: "install",
        path: "install-status",
        timeoutMs: 15_000,
      })) as { status?: string; error?: string } | undefined;
      if (data?.status === "ok") return data;
      if (data?.status === "failed") {
        throw new ConfirmedInstallFailure(data.error || "Install script failed");
      }
    } catch (error) {
      if (error instanceof ConfirmedInstallFailure) {
        throw FlutterError.unavailable(error.message);
      }
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw FlutterError.unavailable(lastError);
}

export async function powerOnNode(nodeId: string, spec: InstallSpec, action: PowerAction) {
  const node = await loadNode(nodeId);
  return daemonFetch(node, {
    uuid: spec.uuid,
    op: "power",
    path: "power",
    body: { ...spec, action },
    timeoutMs: 15_000,
  }) as Promise<{ accepted?: boolean; status?: "offline" | "starting" | "running" | "stopping" } | undefined>;
}

export async function destroyOnNode(nodeId: string, uuid: string) {
  const node = await loadNode(nodeId);
  return daemonFetch(node, {
    uuid,
    op: "destroy",
    path: "destroy",
    timeoutMs: 60_000,
  });
}

type LiveStats = {
  running?: boolean;
  diskBytes?: number;
  stats?: {
    cpuPercent?: number | null;
    memoryBytes?: number | null;
    rxBytes?: number | null;
    txBytes?: number | null;
  } | null;
};

const liveStatsCache = new Map<string, { at: number; data: LiveStats }>();
const liveStatsInflight = new Map<string, Promise<LiveStats>>();
const LIVE_STATS_CACHE_MS = 8_000;

export async function statsOnNode(
  nodeId: string,
  uuid: string,
  opts?: { timeoutMs?: number; node?: Awaited<ReturnType<typeof loadNode>> },
) {
  const cached = liveStatsCache.get(uuid);
  if (cached && Date.now() - cached.at < LIVE_STATS_CACHE_MS) return cached.data;
  const pending = liveStatsInflight.get(uuid);
  if (pending) return pending;
  const run = (async () => {
    const node = opts?.node ?? (await loadNode(nodeId));
    const data = (await daemonFetch(node, {
      uuid,
      op: "stats",
      path: "stats",
      timeoutMs: opts?.timeoutMs ?? 4_000,
    })) as LiveStats;
    liveStatsCache.set(uuid, { at: Date.now(), data });
    return data;
  })();
  liveStatsInflight.set(uuid, run);
  try {
    return await run;
  } finally {
    if (liveStatsInflight.get(uuid) === run) liveStatsInflight.delete(uuid);
  }
}

async function poolMap<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  if (!items.length) return;
  let next = 0;
  const workers = Math.min(Math.max(1, limit), items.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        await fn(items[index] as T);
      }
    }),
  );
}

export async function statsForServers(items: { nodeId: string; uuid: string }[]) {
  const out = new Map<string, LiveStats>();
  const grouped = new Map<string, string[]>();
  for (const item of items) {
    if (!item.nodeId || !item.uuid) continue;
    const list = grouped.get(item.nodeId) ?? [];
    list.push(item.uuid);
    grouped.set(item.nodeId, list);
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    void Promise.all(
      [...grouped.entries()].map(async ([nodeId, uuids]) => {
        const unique = [...new Set(uuids)];
        let node: Awaited<ReturnType<typeof loadNode>>;
        try {
          node = await loadNode(nodeId);
        } catch {
          return;
        }
        if (!isNodeOnline(node.lastHeartbeatAt) || !node.daemonListenUrl) return;
        await poolMap(unique, 8, async (uuid) => {
          try {
            out.set(uuid, await statsOnNode(nodeId, uuid, { node, timeoutMs: 2_500 }));
          } catch {
            /* keep zeros on the card */
          }
        });
      }),
    ).then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
  return out;
}

export async function logsOnNode(nodeId: string, uuid: string, tail = 200) {
  const node = await loadNode(nodeId);
  return daemonFetch(node, {
    uuid,
    op: "logs",
    path: "logs",
    body: { tail },
    timeoutMs: 15_000,
  }) as Promise<{ running?: boolean; lines?: string[] }>;
}

export async function commandOnNode(
  nodeId: string,
  uuid: string,
  command: string,
  opts: { shell?: boolean } = {},
) {
  const node = await loadNode(nodeId);
  return daemonFetch(node, {
    uuid,
    op: "command",
    path: "command",
    body: { command, shell: Boolean(opts.shell) },
    timeoutMs: opts.shell ? 45_000 : 15_000,
  });
}

export async function filesOnNode(
  nodeId: string,
  uuid: string,
  body: {
    action: string;
    path?: string;
    content?: string;
    to?: string;
    name?: string;
    names?: string[];
    contentBase64?: string;
    maxBytes?: number;
    query?: string;
  },
) {
  const node = await loadNode(nodeId);
  const timeoutMs =
    body.action === "upload" || body.action === "extract" || body.action === "compress"
      ? 600_000
      : body.action === "read" || body.action === "write"
        ? 300_000
        : body.action === "search"
          ? 60_000
          : 30_000;
  return daemonFetch(node, {
    uuid,
    op: "files",
    path: "files",
    body,
    timeoutMs,
  });
}

function filenameFromDisposition(value: string | null) {
  if (!value) return "download";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* keep going */
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(value);
  if (quoted?.[1]) return quoted[1];
  const plain = /filename=([^;]+)/i.exec(value);
  return (plain?.[1] || "download").trim();
}

async function daemonFetchBinary(
  node: { _id: { toString(): string }; daemonListenUrl?: string | null; lastHeartbeatAt?: Date | null },
  spec: { uuid: string; op: string; path: string; query?: Record<string, string | string[]>; timeoutMs?: number },
) {
  if (!isNodeOnline(node.lastHeartbeatAt) || !node.daemonListenUrl) {
    throw FlutterError.unavailable("Node daemon is offline");
  }
  const timeoutMs = spec.timeoutMs ?? 60_000;
  const ticket = signDaemonRequest(env().DAEMON_REQUEST_SECRET, {
    nodeId: node._id.toString(),
    serverUuid: spec.uuid,
    op: spec.op,
    ttlMs: timeoutMs,
  });
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(spec.query ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value) {
      params.set(key, value);
    }
  }
  const qs = params.toString();
  const url = `${node.daemonListenUrl.replace(/\/+$/, "")}/v1/servers/${spec.uuid}/${spec.path}${qs ? `?${qs}` : ""}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${ticket}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw FlutterError.unavailable(
      error instanceof Error ? `Daemon unreachable: ${error.message}` : "Daemon unreachable",
    );
  }
  if (!response.ok) {
    const json = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw FlutterError.unavailable(json?.error?.message || `Daemon HTTP ${response.status}`);
  }
  return {
    body: Buffer.from(await response.arrayBuffer()),
    mime: response.headers.get("content-type") || "application/octet-stream",
    filename: filenameFromDisposition(response.headers.get("content-disposition")),
  };
}

export async function downloadOnNode(nodeId: string, uuid: string, path: string, names: string[]) {
  const node = await loadNode(nodeId);
  return daemonFetchBinary(node, {
    uuid,
    op: "files",
    path: "files/download",
    query: { path, names },
    timeoutMs: 600_000,
  });
}

export async function backupsOnNode(
  nodeId: string,
  uuid: string,
  body: { action: string; id?: string },
) {
  const node = await loadNode(nodeId);
  return daemonFetch(node, {
    uuid,
    op: "backups",
    path: "backups",
    body,
    timeoutMs: 300_000,
  });
}

async function daemonNodeOp(
  node: { _id: { toString(): string }; daemonListenUrl?: string | null; lastHeartbeatAt?: Date | null },
  spec: { method: "GET" | "PUT"; path: string; body?: unknown },
) {
  if (!isNodeOnline(node.lastHeartbeatAt) || !node.daemonListenUrl) {
    throw FlutterError.unavailable("Node daemon is offline");
  }
  const ticket = signDaemonRequest(env().DAEMON_REQUEST_SECRET, {
    nodeId: node._id.toString(),
    serverUuid: "node",
    op: "config",
    ttlMs: 30_000,
  });
  const url = `${node.daemonListenUrl.replace(/\/+$/, "")}/v1/node/${spec.path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: spec.method,
      headers: {
        Authorization: `Bearer ${ticket}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: spec.method === "GET" ? undefined : JSON.stringify(spec.body ?? {}),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw FlutterError.unavailable(
      error instanceof Error ? `Daemon unreachable: ${error.message}` : "Daemon unreachable",
    );
  }
  const json = (await response.json().catch(() => null)) as
    | { ok?: boolean; data?: unknown; error?: { message?: string } }
    | null;
  if (!response.ok || json?.ok === false) {
    throw FlutterError.unavailable(json?.error?.message || `Daemon HTTP ${response.status}`);
  }
  return json?.data;
}

export async function getNodeDaemonConfig(nodeId: string) {
  const node = await loadNode(nodeId);
  return daemonNodeOp(node, { method: "GET", path: "config" }) as Promise<{
    path: string;
    content: string;
  }>;
}

export async function saveNodeDaemonConfig(nodeId: string, body: unknown) {
  const parsed = daemonConfigSaveSchema.safeParse(body);
  if (!parsed.success) {
    throw FlutterError.validation("Invalid daemon config", parsed.error.flatten());
  }
  const node = await loadNode(nodeId);
  return daemonNodeOp(node, { method: "PUT", path: "config", body: { content: parsed.data.content } });
}

function isLoopbackUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return /localhost|127\.0\.0\.1|::1/i.test(value);
  }
}

function browserProbeUrl(node: {
  daemonListenUrl?: string | null;
  fqdn?: string | null;
  scheme?: string | null;
  daemonPort?: number | null;
}) {
  const listen = String(node.daemonListenUrl ?? "").replace(/\/+$/, "");
  if (listen && !isLoopbackUrl(listen)) return listen;
  const fqdn = String(node.fqdn ?? "").trim();
  if (fqdn && !isLoopbackUrl(`http://${fqdn}`)) {
    const scheme = node.scheme === "http" ? "http" : "https";
    const port = Number(node.daemonPort) || 8080;
    return `${scheme}://${fqdn}:${port}`;
  }
  return listen || null;
}

export async function probeNodeHealth(nodeId: string) {
  const node = await loadNode(nodeId);
  const listenUrl = node.daemonListenUrl ? String(node.daemonListenUrl).replace(/\/+$/, "") : null;
  const last = node.lastHeartbeatAt ? new Date(node.lastHeartbeatAt) : null;
  const ageMs = last ? Date.now() - last.getTime() : null;
  const online = isNodeOnline(node.lastHeartbeatAt);

  const panelReach: {
    ok: boolean;
    url: string | null;
    error: string | null;
    version: string | null;
    nodeId: string | null;
    docker: { ok: boolean; error?: string } | null;
  } = {
    ok: false,
    url: listenUrl,
    error: listenUrl ? null : "No listen URL yet (waiting for a heartbeat)",
    version: null,
    nodeId: null,
    docker: null,
  };

  if (listenUrl) {
    try {
      const response = await fetch(`${listenUrl}/health`, { signal: AbortSignal.timeout(5_000) });
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        version?: string;
        nodeId?: string;
        docker?: { ok?: boolean; error?: string };
      } | null;
      if (!response.ok) {
        panelReach.error = `HTTP ${response.status}`;
      } else {
        panelReach.ok = true;
        panelReach.version = typeof json?.version === "string" ? json.version : null;
        panelReach.nodeId = typeof json?.nodeId === "string" ? json.nodeId : null;
        panelReach.docker = json?.docker
          ? { ok: Boolean(json.docker.ok), error: json.docker.error }
          : { ok: json?.ok !== false };
      }
    } catch (error) {
      panelReach.error = error instanceof Error ? error.message : "Unreachable";
    }
  }

  const issues: string[] = [];
  const config: {
    readable: boolean;
    path: string | null;
    listenPort: number | null;
    sftpPort: number | null;
    listenUrl: string | null;
    nodeId: string | null;
    issues: string[];
  } = {
    readable: false,
    path: null,
    listenPort: null,
    sftpPort: null,
    listenUrl: null,
    nodeId: null,
    issues,
  };

  if (online && listenUrl) {
    try {
      const file = await getNodeDaemonConfig(nodeId);
      const parsed = JSON.parse(file.content) as {
        listenPort?: unknown;
        sftpPort?: unknown;
        listenUrl?: unknown;
        nodeId?: unknown;
      };
      const listenPort = Number(parsed.listenPort) || 8080;
      const sftpPort = Number(parsed.sftpPort) || 2022;
      const expectedDaemon = Number(node.daemonPort) || 8080;
      const expectedSftp = Number(node.sftpPort) || 2022;
      if (listenPort !== expectedDaemon) {
        issues.push(`Config listenPort is ${listenPort}, this node is set to ${expectedDaemon}`);
      }
      if (sftpPort !== expectedSftp) {
        issues.push(`Config sftpPort is ${sftpPort}, this node is set to ${expectedSftp}`);
      }
      if (typeof parsed.nodeId === "string" && parsed.nodeId && parsed.nodeId !== node._id.toString()) {
        issues.push("Config nodeId does not match this node");
      }
      config.readable = true;
      config.path = file.path;
      config.listenPort = listenPort;
      config.sftpPort = sftpPort;
      config.listenUrl = typeof parsed.listenUrl === "string" ? parsed.listenUrl : null;
      config.nodeId = typeof parsed.nodeId === "string" ? parsed.nodeId : null;
    } catch (error) {
      issues.push(error instanceof Error ? error.message : "Could not read daemon config");
    }
  } else if (!online) {
    issues.push("Heartbeat is stale, so the panel cannot read the daemon config");
  }

  if (panelReach.ok && !online) {
    issues.unshift("Health responded, but the heartbeat is stale. Check the panel URL on the node.");
  }

  return {
    heartbeat: {
      online,
      lastHeartbeatAt: last ? last.toISOString() : null,
      ageMs,
    },
    panelReach,
    config,
    browserProbeUrl: browserProbeUrl(node),
    ports: {
      daemon: Number(node.daemonPort) || 8080,
      sftp: Number(node.sftpPort) || 2022,
    },
  };
}

const SFTP_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseSftpUsername(raw: string) {
  const trimmed = raw.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) return null;
  const username = trimmed.slice(0, dot);
  const uuid = trimmed.slice(dot + 1).toLowerCase();
  if (!username || !SFTP_UUID.test(uuid)) return null;
  return { username, uuid };
}

export async function authenticateSftp(c: Context) {
  const token = readBearerToken(c.req.header("authorization"));
  const body = (await c.req.json().catch(() => ({}))) as {
    nodeId?: string;
    username?: string;
    password?: string;
  };
  const nodeId = String(body.nodeId ?? "");
  const username = String(body.username ?? "");
  const password = String(body.password ?? "");
  const node = await authenticateNodeToken(token, nodeId);
  const parsed = parseSftpUsername(username);

  const reject = async (): Promise<never> => {
    await verifyPassword(await dummyPasswordHash(), password || "x");
    throw FlutterError.unauthorized("Invalid SFTP credentials");
  };

  if (!parsed || !password) return await reject();
  const user = await User.findOne({ username: parsed.username });
  if (!user) return await reject();
  const matches = await verifyPassword(String(user.passwordHash), password);
  if (!matches) throw FlutterError.unauthorized("Invalid SFTP credentials");
  if (user.emailVerified === false) throw FlutterError.unauthorized("Invalid SFTP credentials");

  const server = await Server.findOne({ uuid: parsed.uuid });
  if (!server || server.nodeId.toString() !== node._id.toString()) {
    throw FlutterError.unauthorized("Invalid SFTP credentials");
  }

  const admin = user.role === "admin";
  const owner = server.ownerId.toString() === user._id.toString();
  let permissions: string[] = [];
  if (admin || owner) {
    permissions = ["*"];
  } else {
    const sub = await Subuser.findOne({ serverId: server._id, userId: user._id });
    if (!sub) throw FlutterError.unauthorized("Invalid SFTP credentials");
    permissions = Array.isArray(sub.permissions) ? sub.permissions.map(String) : [];
  }
  if (!admin && node.maintenanceMode) {
    throw FlutterError.unavailable("This node is in maintenance mode. Try again later.");
  }
  if (!hasServerPermission(permissions, "file.read")) {
    throw FlutterError.forbidden("You do not have permission to access files on this server");
  }

  recordActivity({
    serverId: server._id.toString(),
    event: "sftp.login",
    category: "sftp",
    actor: {
      id: user._id.toString(),
      username: user.username,
      kind: "user",
    },
  });

  return {
    uuid: server.uuid,
    write: hasServerPermission(permissions, "file.write"),
    delete: hasServerPermission(permissions, "file.delete"),
  };
}
