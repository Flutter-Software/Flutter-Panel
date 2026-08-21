import { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import { verifyDaemonRequest, readBearerToken } from "@flutter-software/shared/ticket";
import { DAEMON_VERSION, type DaemonConfig } from "./config";
import {
  destroyServer,
  getLogs,
  startInstallServer,
  getInstallStatus,
  liveResources,
  pingDocker,
  powerServer,
  type InstallSpec,
  type PowerAction,
} from "./docker";
import { runDaemonConsole, sendConsoleCommand } from "./console";
import {
  deleteServerPath,
  extractArchive,
  listFiles,
  mkdirServer,
  readServerFile,
  renameServerPath,
  uploadServerFile,
  writeServerFile,
} from "./files";
import { createBackup, deleteBackup, listBackups, restoreBackup } from "./backups";

function unixNewlines(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function asInstallSpec(body: Record<string, unknown>, uuid: string): InstallSpec {
  const allocation = (body.allocation ?? {}) as { ip?: string; port?: number };
  const limits = (body.limits ?? {}) as {
    memoryBytes?: number;
    diskBytes?: number;
    cpuPercent?: number;
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
    },
    allocation: {
      ip: String(allocation.ip ?? "0.0.0.0"),
      port: Number(allocation.port ?? 0),
    },
  };
}

export function createDaemonApp(config: DaemonConfig) {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.onError((error, c) => {
    const message = error instanceof Error ? error.message : "Daemon error";
    return c.json({ ok: false, error: { code: "DAEMON_ERROR", message } }, 500);
  });

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
    const data = await sendConsoleCommand(c.req.param("uuid"), command);
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
        ),
      });
    }
    if (action === "extract") {
      return c.json({ ok: true, data: await extractArchive(config, uuid, path) });
    }
    return c.json({ ok: false, error: { code: "INVALID_INPUT", message: "Unknown file action" } }, 400);
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
          const raw = typeof event.data === "string" ? event.data : "";
          let command = raw.trim();
          try {
            const parsed = JSON.parse(raw) as { event?: string; data?: string };
            if (parsed.event === "command" && parsed.data) command = String(parsed.data);
          } catch {
            /* treat as raw command */
          }
          if (command) void sendConsoleCommand(uuid, command).catch(() => undefined);
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
