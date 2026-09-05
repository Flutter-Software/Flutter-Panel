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
import { ensureCsrfCookie, assertCsrf, requireAdmin, requireUser, requireSession, getAuth, withAuthLimits } from "./auth/session";
import * as apiKeys from "./auth/api-keys";
import { bearerApiKey } from "./auth/api-keys";
import * as auth from "./auth/service";
import * as admin from "./auth/admin";
import * as daemon from "./daemon";
import * as eggs from "./eggs";
import * as servers from "./servers";
import * as subusers from "./subusers";
import * as schedules from "./schedules";
import * as databases from "./databases";
import * as activity from "./activity";
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
    // Cookie is set on this response, so a first-hit POST would fail the
    // header check. Daemon + WS use HMAC tickets instead of the browser cookie.
    const skipCsrf =
      method === "GET" ||
      method === "HEAD" ||
      method === "OPTIONS" ||
      Boolean(bearerApiKey(c)) ||
      path.includes("/daemon/") ||
      path.includes("/ws/console") ||
      path.endsWith("/auth/login") ||
      path.endsWith("/auth/register") ||
      path.endsWith("/auth/verify") ||
      path.endsWith("/auth/verify/resend") ||
      path.endsWith("/auth/totp/login") ||
      path.includes("/auth/invite");
    if (!skipCsrf) {
      assertCsrf(c);
    }
    await next();
  });
  app.use("*", async (c, next) => {
    const auth = await getAuth(c);
    if (!auth) return next();
    return withAuthLimits(auth, () =>
      activity.runActivityContext(
        {
          id: auth.user.id,
          username: auth.user.username,
          kind: "user",
          ip: activity.requestIp(c),
        },
        () => next(),
      ),
    );
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
    // Redis is optional (schedules + sessions live in Mongo). Prisma talks to
    // the same Mongo as Mongoose — if generate is stale, this goes 503.
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
  app.patch("/auth/profile", async (c) => {
    await requireUser(c);
    return c.json({ data: await auth.updateProfile(c, await c.req.json()) });
  });
  app.get("/auth/sessions", async (c) => {
    await requireUser(c);
    return c.json({ data: await auth.listSessions(c) });
  });
  app.delete("/auth/sessions/:id", async (c) => {
    await requireUser(c);
    return c.json({ data: await auth.revokeSession(c, c.req.param("id")) });
  });
  app.post("/auth/totp/setup", async (c) => {
    await requireUser(c);
    return c.json({ data: await auth.setupTotp(c, await c.req.json()) });
  });
  app.post("/auth/totp/enable", async (c) => {
    await requireUser(c);
    return c.json({ data: await auth.enableTotp(c, await c.req.json()) });
  });
  app.post("/auth/totp/disable", async (c) => {
    await requireUser(c);
    return c.json({ data: await auth.disableTotp(c, await c.req.json()) });
  });
  app.post("/auth/totp/cancel", async (c) => {
    await requireUser(c);
    return c.json({ data: await auth.cancelTotpSetup(c) });
  });
  app.get("/account/api-keys", async (c) => {
    const session = await requireSession(c);
    return c.json({ data: await apiKeys.listApiKeys(session.user.id, session.user.role === "admin") });
  });
  app.post("/account/api-keys", async (c) => {
    const session = await requireSession(c);
    return c.json({ data: await apiKeys.createApiKey(session.user, await c.req.json(), activity.requestIp(c)) }, 201);
  });
  app.delete("/account/api-keys/:id", async (c) => {
    const session = await requireSession(c);
    return c.json({ data: await apiKeys.destroyApiKey(session.user.id, c.req.param("id")) });
  });
  app.post("/auth/totp/login", async (c) => {
    const result = await auth.loginWithTotp(c, await c.req.json());
    return c.json({ data: result });
  });
  app.get("/auth/invite/:token", async (c) => c.json({ data: await subusers.peekInvite(c.req.param("token")) }));
  app.post("/auth/invite/complete", async (c) => {
    const result = await subusers.completeInvite(c, await c.req.json());
    return c.json({ data: result }, 201);
  });

  app.get("/daemon/configuration", async (c) => c.json({ data: await daemon.configuration(c) }));
  app.post("/daemon/heartbeat", async (c) => c.json({ data: await daemon.heartbeat(c) }));
  app.post("/daemon/sftp/auth", async (c) => c.json({ data: await daemon.authenticateSftp(c) }));
  app.post("/daemon/servers/:uuid/state", async (c) =>
    c.json({ data: await daemon.applyServerState(c, c.req.param("uuid")) }),
  );

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
  app.get("/client/servers/:id/files/download", async (c) => {
    const session = await requireUser(c);
    const names = (c.req.queries("names") ?? []).map((value) => value.trim()).filter(Boolean);
    const file = await servers.downloadServerFiles(
      c.req.param("id"),
      session.user.id,
      session.user.role === "admin",
      c.req.query("path") || "/",
      names,
    );
    const ascii = file.filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
    c.header("Content-Type", file.mime);
    c.header("Content-Length", String(file.body.length));
    c.header(
      "Content-Disposition",
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    return c.body(new Uint8Array(file.body));
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
  app.get("/client/servers/:id/databases", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: await databases.listServerDatabases(
        c.req.param("id"),
        session.user.id,
        session.user.role === "admin",
      ),
    });
  });
  app.post("/client/servers/:id/databases", async (c) => {
    const session = await requireUser(c);
    return c.json(
      {
        data: {
          database: await databases.createServerDatabase(
            c.req.param("id"),
            session.user.id,
            session.user.role === "admin",
            await c.req.json(),
          ),
        },
      },
      201,
    );
  });
  app.post("/client/servers/:id/databases/:databaseId/rotate", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: {
        database: await databases.rotateServerDatabase(
          c.req.param("id"),
          c.req.param("databaseId"),
          session.user.id,
          session.user.role === "admin",
        ),
      },
    });
  });
  app.delete("/client/servers/:id/databases/:databaseId", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: await databases.deleteServerDatabase(
        c.req.param("id"),
        c.req.param("databaseId"),
        session.user.id,
        session.user.role === "admin",
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
  app.patch("/client/servers/:id/network/:allocationId", async (c) => {
    const session = await requireUser(c);
    return c.json({
      data: {
        allocations: await servers.updateServerAllocation(
          c.req.param("id"),
          c.req.param("allocationId"),
          session.user.id,
          session.user.role === "admin",
          await c.req.json(),
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
  app.get("/client/servers/:id/activity", async (c) => {
    const session = await requireUser(c);
    await servers.requireAccess(c.req.param("id"), session.user.id, session.user.role === "admin", "activity.read");
    return c.json({
      data: await activity.listActivity(c.req.param("id"), {
        category: c.req.query("category") ?? undefined,
        actor: c.req.query("actor") ?? undefined,
        q: c.req.query("q") ?? undefined,
        cursor: c.req.query("cursor") ?? undefined,
      }),
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
  app.get("/admin/database-hosts", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { hosts: await databases.listHosts() } });
  });
  app.post("/admin/database-hosts", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { host: await databases.createHost(await c.req.json()) } }, 201);
  });
  app.post("/admin/database-hosts/test", async (c) => {
    await requireAdmin(c);
    return c.json({ data: await databases.testConnection(await c.req.json()) });
  });
  app.get("/admin/database-hosts/:id", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { host: await databases.getHost(c.req.param("id")) } });
  });
  app.patch("/admin/database-hosts/:id", async (c) => {
    await requireAdmin(c);
    return c.json({ data: { host: await databases.updateHost(c.req.param("id"), await c.req.json()) } });
  });
  app.post("/admin/database-hosts/:id/test", async (c) => {
    await requireAdmin(c);
    return c.json({ data: await databases.testHost(c.req.param("id")) });
  });
  app.delete("/admin/database-hosts/:id", async (c) => {
    await requireAdmin(c);
    return c.json({ data: await databases.deleteHost(c.req.param("id")) });
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
  app.get("/admin/nodes/:id/health", async (c) => {
    await requireAdmin(c);
    return c.json({ data: await daemon.probeNodeHealth(c.req.param("id")) });
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
          // Browser talks to the panel; we open a second socket to the node.
          // Queue outbound frames until that handshake finishes so typed
          // commands aren't dropped on a slow daemon.
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
    sendClient(ws, { event: "error", data: "Node daemon is offline" });
    return;
  }
  const ticket = signDaemonRequest(env().DAEMON_REQUEST_SECRET, {
    nodeId: claims.nodeId,
    serverUuid: claims.uuid,
    op: "console",
    ttlMs: 10 * 60_000,
  });
  // ^http → ws also turns https into wss. Don't replace inside the hostname.
  const base = node.daemonListenUrl.replace(/\/+$/, "").replace(/^http/, "ws");
  const daemonWs = new WebSocket(
    `${base}/v1/servers/${claims.uuid}/console?ticket=${encodeURIComponent(ticket)}`,
  );
  setDaemon(daemonWs);
  daemonWs.addEventListener("message", (event) => {
    if (Number(ws.readyState) === 1) ws.send(wsText(event.data));
  });
  daemonWs.addEventListener("close", () => {
    sendClient(ws, { event: "error", data: "Lost connection to the daemon console" });
  });
  daemonWs.addEventListener("error", () => {
    sendClient(ws, { event: "error", data: "Lost connection to the daemon console" });
  });
}
