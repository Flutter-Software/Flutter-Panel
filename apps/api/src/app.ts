import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { createNodeWebSocket } from "@hono/node-ws";
import type { WSContext } from "hono/ws";
import { FlutterError, PANEL_VERSION } from "@flutter-software/shared";
import { signDaemonRequest } from "@flutter-software/shared/ticket";
import { env, requestOrigin } from "./env";
import { pingMongo } from "./db/mongoose";
import { pingPrisma } from "./db/prisma";
import { pingRedis } from "./redis";
import { ensureCsrfCookie, assertCsrf, requireAdmin, requireUser } from "./auth/session";
import * as auth from "./auth/service";
import * as admin from "./auth/admin";
import * as daemon from "./daemon";
import * as eggs from "./eggs";
import * as servers from "./servers";
import * as subusers from "./subusers";
import * as schedules from "./schedules";
import * as settings from "./settings";
import * as updater from "./update";
import { Node } from "./db/models";
import { isNodeOnline } from "./nodes";
import { verifyConsoleTicket } from "./console-ticket";
import { log } from "./log";

type Variables = {
  requestId: string;
};

export function createApp() {
  const app = new Hono<{ Variables: Variables }>().basePath("/api/v1");
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.use("*", requestId());
  app.use(
    "*",
    cors({
      origin: env().APP_URL,
      credentials: true,
    }),
  );
  app.use("*", async (c, next) => {
    ensureCsrfCookie(c);
    const method = c.req.method.toUpperCase();
    const path = c.req.path;
    const skipCsrf =
      method === "GET" ||
      method === "HEAD" ||
      method === "OPTIONS" ||
      path.includes("/daemon/") ||
      path.includes("/ws/console") ||
      path.endsWith("/auth/login") ||
      path.endsWith("/auth/register") ||
      path.endsWith("/auth/verify") ||
      path.endsWith("/auth/verify/resend") ||
      path.includes("/auth/invite");
    if (!skipCsrf) {
      assertCsrf(c);
    }
    await next();
  });

  app.onError((error, c) => {
    const requestIdValue = c.get("requestId") ?? "unknown";
    if (error instanceof FlutterError) {
      return c.json(
        {
          error: { code: error.code, message: error.message, details: error.details },
          requestId: requestIdValue,
        },
        error.status as 400 | 401 | 403 | 404 | 409 | 503,
      );
    }
    log("error", error instanceof Error ? error.message : "unknown error", {
      requestId: requestIdValue,
    });
    return c.json(
      {
        error: { code: "INTERNAL", message: "Internal server error" },
        requestId: requestIdValue,
      },
      500,
    );
  });

  app.notFound((c) =>
    c.json(
      {
        error: { code: "NOT_FOUND", message: "Not found" },
        requestId: c.get("requestId") ?? "unknown",
      },
      404,
    ),
  );

  app.get("/health", async (c) => {
    const requestIdValue = c.get("requestId");
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

    const startedMongo = Date.now();
    try {
      await pingMongo();
      checks.mongo = { ok: true, latencyMs: Date.now() - startedMongo };
    } catch (error) {
      checks.mongo = {
        ok: false,
        latencyMs: Date.now() - startedMongo,
        error: error instanceof Error ? error.message : "mongo failed",
      };
    }

    const startedPrisma = Date.now();
    try {
      await pingPrisma();
      checks.prisma = { ok: true, latencyMs: Date.now() - startedPrisma };
    } catch (error) {
      checks.prisma = {
        ok: false,
        latencyMs: Date.now() - startedPrisma,
        error: error instanceof Error ? error.message : "prisma failed",
      };
    }

    const startedRedis = Date.now();
    try {
      await pingRedis();
      checks.redis = { ok: true, latencyMs: Date.now() - startedRedis };
    } catch (error) {
      checks.redis = {
        ok: false,
        latencyMs: Date.now() - startedRedis,
        error: error instanceof Error ? error.message : "redis failed",
      };
    }

    const ok = checks.mongo?.ok === true && checks.prisma?.ok === true;
    return c.json(
      {
        ok,
        service: "api",
        version: PANEL_VERSION,
        requestId: requestIdValue,
        checks,
      },
      ok ? 200 : 503,
    );
  });

  app.get("/auth/setup", async (c) => c.json({ data: await auth.setupStatus() }));
  app.get("/auth/me", async (c) => c.json({ data: { user: await auth.me(c) } }));
  app.post("/auth/register", async (c) => {
    const result = await auth.register(c, await c.req.json());
    return c.json({ data: result }, 201);
  });
  app.post("/auth/login", async (c) => {
    const result = await auth.login(c, await c.req.json());
    return c.json({ data: result });
  });
  app.post("/auth/verify", async (c) => {
    const result = await auth.verifyEmail(c, await c.req.json());
    return c.json({ data: result });
  });
  app.post("/auth/verify/resend", async (c) => {
    return c.json({ data: await auth.resendVerification(c, await c.req.json()) });
  });
  app.post("/auth/logout", async (c) => {
    await auth.logout(c);
    return c.json({ data: { ok: true } });
  });
  app.post("/auth/password", async (c) => {
    await requireUser(c);
    return c.json({ data: await auth.changePassword(c, await c.req.json()) });
  });
  app.get("/auth/invite/:token", async (c) => c.json({ data: await subusers.peekInvite(c.req.param("token")) }));
  app.post("/auth/invite/complete", async (c) => {
    const result = await subusers.completeInvite(c, await c.req.json());
    return c.json({ data: result }, 201);
  });

  app.get("/daemon/configuration", async (c) => c.json({ data: await daemon.configuration(c) }));
  app.post("/daemon/heartbeat", async (c) => c.json({ data: await daemon.heartbeat(c) }));

  app.get("/client/servers", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: {
        servers: await servers.listClientServers(session.user.id, session.user.role === "admin"),
      },
    });
  });
  app.get("/client/servers/:id", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: {
        server: await servers.getClientServer(
          c.req.param("id"),
          session.user.id,
          session.user.role === "admin",
        ),
      },
    });
  });
  app.post("/client/servers/:id/power", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: {
        server: await servers.powerServer(
          c.req.param("id"),
          session.user.id,
          session.user.role === "admin",
          await c.req.json(),
        ),
      },
    });
  });
  app.patch("/client/servers/:id", async (c) => {
    const session = await requireUser(c);
    const access = await servers.requireAccess(
      c.req.param("id"),
      session.user.id,
      session.user.role === "admin",
    );
    const body = (await c.req.json()) as Record<string, unknown>;
    if (body.name !== undefined || body.description !== undefined) {
      servers.assertPerm(access, "settings.rename");
    }
    if (body.environment !== undefined) {
      servers.assertPerm(access, "startup.update");
    }
    const allowed =
      session.user.role === "admin"
        ? body
        : {
            name: body.name,
            description: body.description,
            environment: body.environment,
          };
    return c.json({
      data: { server: await servers.updateServer(c.req.param("id"), allowed, session.user.id) },
    });
  });
  app.post("/client/servers/:id/install", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: {
        server: await servers.reinstallServer(
          c.req.param("id"),
          session.user.id,
          session.user.role === "admin",
        ),
      },
    });
  });
  app.get("/client/servers/:id/console/socket", async (c) => {
    const session = await requireUser(c);
    const origin = requestOrigin({
      host: c.req.header("x-forwarded-host") || c.req.header("host"),
      proto: c.req.header("x-forwarded-proto"),
    });
    return c.json({
      data: await servers.consoleSocket(
        c.req.param("id"),
        session.user.id,
        session.user.role === "admin",
        origin,
      ),
    });
  });
  app.get("/client/servers/:id/console", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: await servers.serverLogs(c.req.param("id"), session.user.id, session.user.role === "admin"),
    });
  });
  app.post("/client/servers/:id/command", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: await servers.serverCommand(
        c.req.param("id"),
        session.user.id,
        session.user.role === "admin",
        await c.req.json(),
      ),
    });
  });
  app.post("/client/servers/:id/files", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: await servers.serverFiles(
        c.req.param("id"),
        session.user.id,
        session.user.role === "admin",
        await c.req.json(),
      ),
    });
  });
  app.post("/client/servers/:id/backups", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: await servers.serverBackups(
        c.req.param("id"),
        session.user.id,
        session.user.role === "admin",
        await c.req.json(),
      ),
    });
  });
  app.get("/client/servers/:id/network", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: {
        allocations: await servers.serverNetwork(
          c.req.param("id"),
          session.user.id,
          session.user.role === "admin",
        ),
      },
    });
  });
  app.get("/client/servers/:id/users", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: await subusers.listSubusers(
        c.req.param("id"),
        session.user.id,
        session.user.role === "admin",
      ),
    });
  });
  app.get("/client/servers/:id/users/search", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: await subusers.searchUsers(
        c.req.param("id"),
        session.user.id,
        session.user.role === "admin",
        c.req.query("q") ?? "",
      ),
    });
  });
  app.post("/client/servers/:id/users", async (c) => {
    const session = await requireUser(c);
    return c.json(
      {
        data: await subusers.createSubuser(
          c.req.param("id"),
          session.user.id,
          session.user.role === "admin",
          await c.req.json(),
          session.user.username,
        ),
      },
      201,
    );
  });
  app.patch("/client/servers/:id/users/:subId", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: await subusers.updateSubuser(
        c.req.param("id"),
        c.req.param("subId"),
        session.user.id,
        session.user.role === "admin",
        await c.req.json(),
      ),
    });
  });
  app.post("/client/servers/:id/users/:subId/invite", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: await subusers.resendSubuserInvite(
        c.req.param("id"),
        c.req.param("subId"),
        session.user.id,
        session.user.role === "admin",
        session.user.username,
      ),
    });
  });
  app.delete("/client/servers/:id/users/:subId", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: await subusers.deleteSubuser(
        c.req.param("id"),
        c.req.param("subId"),
        session.user.id,
        session.user.role === "admin",
      ),
    });
  });
  app.get("/client/servers/:id/schedules", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: await schedules.listSchedules(
        c.req.param("id"),
        session.user.id,
        session.user.role === "admin",
      ),
    });
  });
  app.post("/client/servers/:id/schedules", async (c) => {
    const session = await requireUser(c);
    return c.json(
      {
        data: await schedules.createSchedule(
          c.req.param("id"),
          session.user.id,
          session.user.role === "admin",
          await c.req.json(),
        ),
      },
      201,
    );
  });
  app.patch("/client/servers/:id/schedules/:scheduleId", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: await schedules.updateSchedule(
        c.req.param("id"),
        c.req.param("scheduleId"),
        session.user.id,
        session.user.role === "admin",
        await c.req.json(),
      ),
    });
  });
  app.post("/client/servers/:id/schedules/:scheduleId/run", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: await schedules.runScheduleNow(
        c.req.param("id"),
        c.req.param("scheduleId"),
        session.user.id,
        session.user.role === "admin",
      ),
    });
  });
  app.delete("/client/servers/:id/schedules/:scheduleId", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: await schedules.deleteSchedule(
        c.req.param("id"),
        c.req.param("scheduleId"),
        session.user.id,
        session.user.role === "admin",
      ),
    });
  });

  app.get("/branding", async (c) => c.json({ data: await settings.getPublicBranding() }));
  app.get("/branding/logo", async (c) => {
    const file = await settings.getLogo();
    if (!file) return c.body("", 404);
    c.header("Content-Type", file.mime);
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.body(new Uint8Array(file.data));
  });
  app.get("/admin/settings", async (c) => {
    await requireAdmin(c);
    return c.json({ data: await settings.getSettings() });
  });
  app.patch("/admin/settings", async (c) => {
    await requireAdmin(c);
    return c.json({ data: await settings.updateSettings(await c.req.json()) });
  });
  app.patch("/admin/settings/branding", async (c) => {
    await requireAdmin(c);
    return c.json({ data: await settings.updateBranding(await c.req.json()) });
  });
  app.get("/admin/settings/update", async (c) => {
    await requireAdmin(c);
    return c.json({ data: await updater.getUpdateStatus() });
  });
  app.post("/admin/settings/update", async (c) => {
    await requireAdmin(c);
    return c.json({ data: await updater.startUpdate() });
  });
  app.post("/admin/settings/smtp/test", async (c) => {
    await requireAdmin(c);
    return c.json({ data: await settings.testSmtp(await c.req.json()) });
  });
  app.get("/admin/users", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { users: await auth.listUsers() } });
  });
  app.post("/admin/users", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { user: await auth.createUser(await c.req.json()) } }, 201);
  });
  app.get("/admin/users/:id", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { user: await auth.getUser(c.req.param("id")) } });
  });
  app.patch("/admin/users/:id", async (c) => {
    const session = await requireAdmin(c);
    return c.json({
      data: { user: await auth.updateUser(c.req.param("id"), await c.req.json(), session.user.id) },
    });
  });
  app.get("/admin/locations", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { locations: await admin.listLocations() } });
  });
  app.post("/admin/locations", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { location: await admin.createLocation(await c.req.json()) } }, 201);
  });
  app.get("/admin/locations/:id", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { location: await admin.getLocation(c.req.param("id")) } });
  });
  app.patch("/admin/locations/:id", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { location: await admin.updateLocation(c.req.param("id"), await c.req.json()) } });
  });
  app.delete("/admin/locations/:id", async (c) => {
    await requireAdmin(c);
    return c.json({ data: await admin.deleteLocation(c.req.param("id")) });
  });
  app.get("/admin/nodes", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { nodes: await admin.listNodes() } });
  });
  app.post("/admin/nodes", async (c) => {
    await requireAdmin(c);
    return c.json({ data: await admin.createNode(await c.req.json()) }, 201);
  });
  app.get("/admin/nodes/:id", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { node: await admin.getNode(c.req.param("id")) } });
  });
  app.patch("/admin/nodes/:id", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { node: await admin.updateNode(c.req.param("id"), await c.req.json()) } });
  });
  app.get("/admin/nodes/:id/config", async (c) => {
    await requireAdmin(c);
    return c.json({ data: await daemon.getNodeDaemonConfig(c.req.param("id")) });
  });
  app.put("/admin/nodes/:id/config", async (c) => {
    await requireAdmin(c);
    return c.json({ data: await daemon.saveNodeDaemonConfig(c.req.param("id"), await c.req.json()) });
  });
  app.get("/admin/nodes/:id/allocations", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { allocations: await admin.listAllocations(c.req.param("id")) } });
  });
  app.post("/admin/nodes/:id/allocations", async (c) => {
    await requireAdmin(c);
    return c.json(
      { data: { allocations: await admin.createAllocations(c.req.param("id"), await c.req.json()) } },
      201,
    );
  });
  app.delete("/admin/nodes/:id/allocations/:allocationId", async (c) => {
    await requireAdmin(c);
    return c.json({
      data: await admin.deleteAllocation(c.req.param("id"), c.req.param("allocationId")),
    });
  });
  app.delete("/admin/nodes/:id", async (c) => {
    await requireAdmin(c);
    return c.json({ data: await admin.deleteNode(c.req.param("id")) });
  });
  app.post("/admin/nodes/:id/token", async (c) => {
    await requireAdmin(c);
    return c.json({ data: await admin.revealDaemonToken(c.req.param("id")) });
  });
  app.get("/admin/nests", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { nests: await eggs.listNests() } });
  });
  app.post("/admin/nests", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { nest: await eggs.createNest(await c.req.json()) } }, 201);
  });
  app.get("/admin/nests/:id", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { nest: await eggs.getNest(c.req.param("id")) } });
  });
  app.patch("/admin/nests/:id", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { nest: await eggs.updateNest(c.req.param("id"), await c.req.json()) } });
  });
  app.delete("/admin/nests/:id", async (c) => {
    await requireAdmin(c);
    return c.json({ data: await eggs.deleteNest(c.req.param("id")) });
  });
  app.post("/admin/eggs/import", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { egg: await eggs.importEgg(await c.req.json()) } }, 201);
  });
  app.post("/admin/eggs", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { egg: await eggs.createEgg(await c.req.json()) } }, 201);
  });
  app.get("/admin/eggs/:id", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { egg: await eggs.getEgg(c.req.param("id")) } });
  });
  app.patch("/admin/eggs/:id", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { egg: await eggs.updateEgg(c.req.param("id"), await c.req.json()) } });
  });
  app.delete("/admin/eggs/:id", async (c) => {
    await requireAdmin(c);
    return c.json({ data: await eggs.deleteEgg(c.req.param("id")) });
  });
  app.get("/admin/servers", async (c) => {
    const session = await requireAdmin(c);
    return c.json({
      data: { servers: await servers.listClientServers(session.user.id, true) },
    });
  });
  app.post("/admin/servers", async (c) => {
    const session = await requireAdmin(c);
    return c.json({ data: { server: await servers.createServer(await c.req.json(), session.user.id) } }, 201);
  });
  app.get("/admin/servers/:id", async (c) => {
    const session = await requireAdmin(c);
    return c.json({
      data: { server: await servers.getClientServer(c.req.param("id"), session.user.id, true) },
    });
  });
  app.patch("/admin/servers/:id", async (c) => {
    const session = await requireAdmin(c);
    return c.json({
      data: { server: await servers.updateServer(c.req.param("id"), await c.req.json(), session.user.id) },
    });
  });
  app.post("/admin/servers/:id/install", async (c) => {
    const session = await requireAdmin(c);
    return c.json({
      data: { server: await servers.reinstallServer(c.req.param("id"), session.user.id, true) },
    });
  });
  app.delete("/admin/servers/:id", async (c) => {
    await requireAdmin(c);
    return c.json({ data: await servers.deleteServer(c.req.param("id")) });
  });

  app.get(
    "/ws/console",
    upgradeWebSocket((c) => {
      const claims = verifyConsoleTicket(env().SESSION_SECRET, c.req.query("token"));
      let daemonWs: WebSocket | null = null;
      const queued: string[] = [];
      return {
        onOpen(_event, ws) {
          if (!claims) {
            sendClient(ws, { event: "error", data: "Invalid or expired console ticket" });
            ws.close();
            return;
          }
          void connectDaemonConsole(claims, ws, (socket) => {
            daemonWs = socket;
            const flush = () => {
              for (const message of queued) socket.send(message);
              queued.length = 0;
            };
            socket.addEventListener("open", flush);
            if (socket.readyState === WebSocket.OPEN) flush();
          });
        },
        onMessage(event) {
          const payload = String(event.data);
          if (daemonWs && daemonWs.readyState === WebSocket.OPEN) {
            daemonWs.send(payload);
            return;
          }
          queued.push(payload);
        },
        onClose() {
          daemonWs?.close();
        },
        onError() {
          daemonWs?.close();
        },
      };
    }),
  );

  return { app, injectWebSocket };
}

function sendClient(ws: WSContext, payload: { event: string; data: string }) {
  if (Number(ws.readyState) !== 1) return;
  ws.send(JSON.stringify(payload));
}

function wsText(data: unknown) {
  if (typeof data === "string") return data;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }
  return String(data);
}

async function connectDaemonConsole(
  claims: { uuid: string; nodeId: string },
  ws: WSContext,
  setDaemon: (socket: WebSocket) => void,
) {
  const node = await Node.findById(claims.nodeId);
  if (!node || !isNodeOnline(node.lastHeartbeatAt) || !node.daemonListenUrl) {
    sendClient(ws, { event: "status", data: "offline" });
    sendClient(ws, { event: "error", data: "Node daemon is offline" });
    return;
  }
  const ticket = signDaemonRequest(env().DAEMON_REQUEST_SECRET, {
    nodeId: claims.nodeId,
    serverUuid: claims.uuid,
    op: "console",
    ttlMs: 10 * 60_000,
  });
  const base = node.daemonListenUrl.replace(/\/+$/, "").replace(/^http/, "ws");
  const daemonWs = new WebSocket(
    `${base}/v1/servers/${claims.uuid}/console?ticket=${encodeURIComponent(ticket)}`,
  );
  setDaemon(daemonWs);
  daemonWs.addEventListener("message", (event) => {
    if (Number(ws.readyState) === 1) ws.send(wsText(event.data));
  });
  daemonWs.addEventListener("close", () => {
    sendClient(ws, { event: "status", data: "offline" });
  });
  daemonWs.addEventListener("error", () => {
    sendClient(ws, { event: "error", data: "Lost connection to the daemon console" });
  });
}
