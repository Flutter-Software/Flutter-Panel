import {
  FlutterError,
  heartbeatSchema,
  daemonServerStateSchema,
  daemonConfigSaveSchema,
  PANEL_VERSION,
  type PowerAction,
} from "@flutter-software/shared";
import { signDaemonRequest, readBearerToken } from "@flutter-software/shared/ticket";
import { env } from "./env";
import { Node, Server } from "./db/models";
import { authenticateNodeToken, isNodeOnline, panelApiUrl } from "./nodes";
import type { Context } from "hono";

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
  return {
    panelUrl: panelApiUrl(host ? `${proto}://${host}` : undefined),
    nodeId: node._id.toString(),
    listenHost: "0.0.0.0",
    listenPort: 8080,
    // Template for `daemon:configure`. The real listenUrl is whatever the
    // operator passed (--listen-url / tunnel); heartbeat overwrites the node row.
    listenUrl: `http://127.0.0.1:8080`,
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

  if (parsed.data.install) {
    if (server.status === "installing" || server.status === "install_failed") {
      server.status = parsed.data.install.ok ? "offline" : "install_failed";
      await server.save();
    }
    return { ok: true, status: server.status };
  }

  if (server.status === "installing" || server.status === "install_failed") {
    return { ok: true, status: server.status };
  }

  const next = parsed.data.status;
  if (next) {
    server.status = next;
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

export async function statsOnNode(nodeId: string, uuid: string) {
  const node = await loadNode(nodeId);
  return daemonFetch(node, {
    uuid,
    op: "stats",
    path: "stats",
    timeoutMs: 4_000,
  }) as Promise<{
    running?: boolean;
    diskBytes?: number;
    stats?: {
      cpuPercent?: number | null;
      memoryBytes?: number | null;
      rxBytes?: number | null;
      txBytes?: number | null;
    } | null;
  }>;
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
    contentBase64?: string;
    maxBytes?: number;
  },
) {
  const node = await loadNode(nodeId);
  const timeoutMs =
    body.action === "upload" || body.action === "extract"
      ? 600_000
      : body.action === "read" || body.action === "write"
        ? 300_000
        : 30_000;
  return daemonFetch(node, {
    uuid,
    op: "files",
    path: "files",
    body,
    timeoutMs,
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
