import { Hono } from "hono";
import { cors } from "hono/cors";
import { createNodeWebSocket } from "@hono/node-ws";
import { verifyDaemonRequest, readBearerToken } from "@flutter-software/shared/ticket";
import { DAEMON_VERSION, defaultConfigPath, readDaemonConfigFile, writeDaemonConfig, type DaemonConfig, type DaemonFileConfig } from "./config";
import {
  destroyServer,
  getLogs,
  startInstallServer,
  getInstallStatus,
  liveResources,
  pingDocker,
  powerServer,
  runOfflineCommand,
  containerRunning,
  isInstallRunning,
  bindDaemonConfig,
  type InstallSpec,
  type PowerAction,
} from "./docker";
import { runDaemonConsole, sendConsoleCommand } from "./console";
import { getProcessState } from "./process-state";
import {
  compressArchive,
  deleteServerPath,
  downloadServer,
  extractArchive,
  listFiles,
  mkdirServer,
  readServerFile,
  renameServerPath,
  searchFiles,
  statServerPath,
  uploadServerFile,
  writeServerFile,
} from "./files";
import { createBackup, deleteBackup, listBackups, restoreBackup } from "./backups";

function unixNewlines(value: string) {
  // Windows editors + egg JSON paste will otherwise break bash install scripts.
  return value.replace(/\r/g, "");
}

function asInstallSpec(body: Record<string, unknown>, uuid: string): InstallSpec {
  const allocation = (body.allocation ?? {}) as { ip?: string; port?: number };
  const extras = Array.isArray(body.allocations) ? body.allocations : [];
  const limits = (body.limits ?? {}) as {
    memoryBytes?: number;
    diskBytes?: number;
    cpuPercent?: number;
    cpuPinning?: number;
  };
  const environment =
    body.environment && typeof body.environment === "object"
      ? Object.fromEntries(
          Object.entries(body.environment as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  return {
    uuid,
    name: String(body.name ?? ""),
    dockerImage: String(body.dockerImage ?? "busybox:1.36"),
    startup: String(body.startup ?? ""),
    stopCommand: String(body.stopCommand ?? "stop"),
    installScript: unixNewlines(String(body.installScript ?? "")),
    installImage: String(body.installImage ?? "alpine:3.20"),
    environment,
    limits: {
      memoryBytes: Number(limits.memoryBytes ?? 0),
      diskBytes: Number(limits.diskBytes ?? 0),
      cpuPercent: Number(limits.cpuPercent ?? 0),
      cpuPinning: Number(limits.cpuPinning ?? 0),
    },
    allocation: {
      ip: String(allocation.ip ?? "0.0.0.0"),
      port: Number(allocation.port ?? 0),
    },
    allocations: extras
      .filter((row): row is { ip?: string; port?: number } => Boolean(row) && typeof row === "object")
      .map((row) => ({
        ip: String(row.ip ?? "0.0.0.0"),
        port: Number(row.port ?? 0),
      })),
  };
}

export function createDaemonApp(config: DaemonConfig) {
  bindDaemonConfig(config);
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.onError((error, c) => {
    const message = error instanceof Error ? error.message : "Daemon error";
    return c.json({ ok: false, error: { code: "DAEMON_ERROR", message } }, 500);
  });

  app.use("/health", cors({ origin: "*" }));
  app.get("/health", async (c) => {
    let docker = { ok: false as boolean, error: "not connected" as string | undefined };
    try {
      await pingDocker();
      docker = { ok: true, error: undefined };
    } catch (error) {
      docker = { ok: false, error: error instanceof Error ? error.message : "docker ping failed" };
    }
    return c.json({
      ok: docker.ok,
      service: "daemon",
      version: DAEMON_VERSION,
      nodeId: config.nodeId,
      docker,
    });
  });

  app.use("/v1/node/*", async (c, next) => {
    const token = readBearerToken(c.req.header("authorization")) || "";
    const claims = verifyDaemonRequest(config.requestSecret, token);
    if (!claims.ok) {
      return c.json({ ok: false, error: claims.error }, 401);
    }
    if (claims.data.nodeId !== config.nodeId || claims.data.op !== "config" || claims.data.serverUuid !== "node") {
      return c.json(
        { ok: false, error: { code: "DAEMON_TICKET_INVALID", message: "Ticket does not allow node config access." } },
        401,
      );
    }
    await next();
  });

  app.get("/v1/node/config", async (c) => {
    const file = await readDaemonConfigFile();
    const content = JSON.stringify(
      file ?? {
        panelUrl: config.panelUrl,
        nodeId: config.nodeId,
        token: config.daemonToken,
        requestSecret: config.requestSecret,
        listenHost: config.listenHost,
        listenPort: config.listenPort,
        listenUrl: config.listenUrl,
        dataDir: config.dataDir,
        sftpPort: config.sftpPort,
      },
      null,
      2,
    );
    return c.json({ ok: true, data: { path: defaultConfigPath(), content: `${content}\n` } });
  });

  app.put("/v1/node/config", async (c) => {
    const body = ((await c.req.json().catch(() => ({}))) as { content?: string }) ?? {};
    let parsed: DaemonFileConfig;
    try {
      parsed = JSON.parse(String(body.content ?? "")) as DaemonFileConfig;
    } catch {
      return c.json(
        { ok: false, error: { code: "INVALID_INPUT", message: "Config must be valid JSON." } },
        400,
      );
    }
    const required: (keyof DaemonFileConfig)[] = [
      "panelUrl",
      "nodeId",
      "token",
      "requestSecret",
      "listenHost",
      "listenPort",
      "listenUrl",
      "dataDir",
    ];
    for (const key of required) {
      if (parsed[key] === undefined || parsed[key] === null || parsed[key] === "") {
        return c.json(
          { ok: false, error: { code: "INVALID_INPUT", message: `Missing ${key} in daemon config.` } },
          400,
        );
      }
    }
    const listenPort = Number(parsed.listenPort);
    if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
      return c.json(
        { ok: false, error: { code: "INVALID_INPUT", message: "listenPort must be between 1 and 65535." } },
        400,
      );
    }
    const sftpPort = Number(parsed.sftpPort ?? 2022);
    if (!Number.isInteger(sftpPort) || sftpPort < 1 || sftpPort > 65535) {
      return c.json(
        { ok: false, error: { code: "INVALID_INPUT", message: "sftpPort must be between 1 and 65535." } },
        400,
      );
    }
    const path = await writeDaemonConfig({
      panelUrl: String(parsed.panelUrl).replace(/\/+$/, ""),
      nodeId: String(parsed.nodeId),
      token: String(parsed.token),
      requestSecret: String(parsed.requestSecret),
      listenHost: String(parsed.listenHost),
      listenPort,
      listenUrl: String(parsed.listenUrl).replace(/\/+$/, ""),
      dataDir: String(parsed.dataDir),
      sftpPort,
    });
    return c.json({
      ok: true,
      data: { path, restartRequired: true },
    });
  });

  app.use("/v1/servers/*", async (c, next) => {
    const token = readBearerToken(c.req.header("authorization")) || c.req.query("ticket") || "";
    const claims = verifyDaemonRequest(config.requestSecret, token);
    if (!claims.ok) {
      return c.json({ ok: false, error: claims.error }, 401);
    }
    if (claims.data.nodeId !== config.nodeId) {
      return c.json(
        { ok: false, error: { code: "DAEMON_TICKET_INVALID", message: "Ticket node does not match this daemon." } },
        401,
      );
    }
    const uuid = c.req.path.split("/")[3] ?? "";
    if (claims.data.serverUuid !== uuid) {
      return c.json(
        {
          ok: false,
          error: { code: "DAEMON_TICKET_INVALID", message: "Ticket server does not match this path." },
        },
        401,
      );
    }
    await next();
  });

  app.post("/v1/servers/:uuid/install", async (c) => {
    const spec = asInstallSpec((await c.req.json().catch(() => ({}))) as Record<string, unknown>, c.req.param("uuid"));
    const data = await startInstallServer(config, spec);
    return c.json({ ok: true, data });
  });
  app.post("/v1/servers/:uuid/install-status", async (c) => {
    const data = await getInstallStatus(config, c.req.param("uuid"));
    return c.json({ ok: true, data });
  });

  app.post("/v1/servers/:uuid/destroy", async (c) => {
    const data = await destroyServer(config, c.req.param("uuid"));
    return c.json({ ok: true, data });
  });

  app.post("/v1/servers/:uuid/power", async (c) => {
    const body = ((await c.req.json().catch(() => ({}))) as Record<string, unknown>) ?? {};
    const action = String(body.action ?? "") as PowerAction;
    if (!["start", "stop", "restart", "kill"].includes(action)) {
      return c.json(
        { ok: false, error: { code: "INVALID_INPUT", message: "action must be start, stop, restart, or kill." } },
        400,
      );
    }
    const spec = asInstallSpec(body, c.req.param("uuid"));
    const data = await powerServer(config, spec, action);
    return c.json({ ok: true, data });
  });

  async function statsPayload(uuid: string) {
    return liveResources(config, uuid);
  }

  async function dispatchCommand(uuid: string, command: string, opts: { shell?: boolean } = {}) {
    if (isInstallRunning(uuid)) {
      throw new Error("Unavailable while installing");
    }
    const process = getProcessState(uuid);
    if (process === "running" || (await containerRunning(uuid).catch(() => false))) {
      return sendConsoleCommand(uuid, command);
    }
    if (process === "starting" || process === "stopping") {
      throw new Error("Wait until the server has started or stopped");
    }
    if (!opts.shell) {
      throw new Error("Server is offline");
    }
    return runOfflineCommand(config, uuid, command);
  }

  app.get("/v1/servers/:uuid/stats", async (c) => {
    return c.json({ ok: true, data: await statsPayload(c.req.param("uuid")) });
  });

  app.post("/v1/servers/:uuid/stats", async (c) => {
    return c.json({ ok: true, data: await statsPayload(c.req.param("uuid")) });
  });

  app.post("/v1/servers/:uuid/logs", async (c) => {
    const body = ((await c.req.json().catch(() => ({}))) as Record<string, unknown>) ?? {};
    const tail = Math.min(1000, Math.max(1, Number(body.tail ?? 200)));
    const data = await getLogs(c.req.param("uuid"), tail);
    return c.json({ ok: true, data });
  });

  app.post("/v1/servers/:uuid/command", async (c) => {
    const body = ((await c.req.json().catch(() => ({}))) as Record<string, unknown>) ?? {};
    const command = String(body.command ?? "").trim();
    if (!command) {
      return c.json({ ok: false, error: { code: "INVALID_INPUT", message: "command is required" } }, 400);
    }
    const data = await dispatchCommand(c.req.param("uuid"), command, { shell: body.shell === true });
    return c.json({ ok: true, data: data ?? { ok: true } });
  });

  app.post("/v1/servers/:uuid/files", async (c) => {
    const uuid = c.req.param("uuid");
    const body = ((await c.req.json().catch(() => ({}))) as Record<string, unknown>) ?? {};
    const action = String(body.action ?? "list");
    const path = String(body.path ?? "/");
    if (action === "list") {
      return c.json({ ok: true, data: await listFiles(config, uuid, path) });
    }
    if (action === "read") {
      return c.json({ ok: true, data: await readServerFile(config, uuid, path) });
    }
    if (action === "write") {
      return c.json({
        ok: true,
        data: await writeServerFile(config, uuid, path, String(body.content ?? "")),
      });
    }
    if (action === "mkdir") {
      return c.json({ ok: true, data: await mkdirServer(config, uuid, path) });
    }
    if (action === "delete") {
      return c.json({ ok: true, data: await deleteServerPath(config, uuid, path) });
    }
    if (action === "rename") {
      return c.json({
        ok: true,
        data: await renameServerPath(config, uuid, path, String(body.to ?? "")),
      });
    }
    if (action === "upload") {
      return c.json({
        ok: true,
        data: await uploadServerFile(
          config,
          uuid,
          path,
          String(body.name ?? ""),
          String(body.contentBase64 ?? ""),
          Number(body.maxBytes ?? 0) || undefined,
        ),
      });
    }
    if (action === "extract") {
      return c.json({ ok: true, data: await extractArchive(config, uuid, path) });
    }
    if (action === "compress") {
      return c.json({ ok: true, data: await compressArchive(config, uuid, path, body.names) });
    }
    if (action === "search") {
      return c.json({ ok: true, data: await searchFiles(config, uuid, path, String(body.query ?? "")) });
    }
    if (action === "stat") {
      return c.json({ ok: true, data: await statServerPath(config, uuid, path) });
    }
    return c.json({ ok: false, error: { code: "INVALID_INPUT", message: "Unknown file action" } }, 400);
  });

  app.get("/v1/servers/:uuid/files/download", async (c) => {
    const uuid = c.req.param("uuid");
    const path = c.req.query("path") || "/";
    const names = (c.req.queries("names") ?? []).map((value) => value.trim()).filter(Boolean);
    const file = await downloadServer(config, uuid, path, names);
    const ascii = file.filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
    c.header("Content-Type", file.mime);
    c.header("Content-Length", String(file.body.length));
    c.header(
      "Content-Disposition",
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    return c.body(new Uint8Array(file.body));
  });

  app.post("/v1/servers/:uuid/backups", async (c) => {
    const uuid = c.req.param("uuid");
    const body = ((await c.req.json().catch(() => ({}))) as Record<string, unknown>) ?? {};
    const action = String(body.action ?? "list");
    if (action === "list") {
      return c.json({ ok: true, data: { backups: await listBackups(config, uuid) } });
    }
    if (action === "create") {
      return c.json({ ok: true, data: { backup: await createBackup(config, uuid) } }, 201);
    }
    if (action === "delete") {
      return c.json({ ok: true, data: await deleteBackup(config, uuid, String(body.id ?? "")) });
    }
    if (action === "restore") {
      return c.json({ ok: true, data: await restoreBackup(config, uuid, String(body.id ?? "")) });
    }
    return c.json({ ok: false, error: { code: "INVALID_INPUT", message: "Unknown backup action" } }, 400);
  });

  app.get(
    "/v1/servers/:uuid/console",
    upgradeWebSocket((c) => {
      const uuid = c.req.param("uuid") ?? "";
      const ac = new AbortController();
      return {
        onOpen(_event, ws) {
          void runDaemonConsole(config, uuid, ws, ac.signal);
        },
        onMessage(event) {
          const raw =
            typeof event.data === "string"
              ? event.data
              : Buffer.isBuffer(event.data)
                ? event.data.toString("utf8")
                : ArrayBuffer.isView(event.data)
                  ? Buffer.from(event.data.buffer, event.data.byteOffset, event.data.byteLength).toString("utf8")
                  : "";
          let command = raw.trim();
          try {
            const parsed = JSON.parse(raw) as { event?: string; data?: string };
            if (parsed.event === "command" && parsed.data) command = String(parsed.data);
          } catch {
            /* treat as raw command */
          }
          if (command) void dispatchCommand(uuid, command, { shell: true }).catch(() => undefined);
        },
        onClose() {
          ac.abort();
        },
        onError() {
          ac.abort();
        },
      };
    }),
  );

  return { app, injectWebSocket };
}
