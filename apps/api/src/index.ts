import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { connectMongo } from "./db/mongoose";
import { env } from "./env";
import { connectRedis } from "./redis";
import { log } from "./log";

async function main() {
  env();
  await connectMongo();
  const { seedDefaults } = await import("./eggs");
  await seedDefaults();
  const { startScheduleRunner } = await import("./schedules");
  startScheduleRunner();
  try {
    await connectRedis();
  } catch (error) {
    // Don't take the API down because Redis is still starting (compose race).
    log("warn", "redis unavailable", { error });
  }
  const { startTelemetry } = await import("./telemetry");
  startTelemetry();
  const { app, injectWebSocket } = createApp();
  const server = serve({ fetch: app.fetch, port: env().PORT, hostname: env().HOST }, (info) => {
    log("info", "api listening", { host: env().HOST, port: info.port });
  });
  // An upgrading socket can have no "error" listener, so a browser dropping the
  // connection (a page change, a closed tab) would be an uncaught exception that
  // takes the whole API down. Must be registered before injectWebSocket.
  server.on("upgrade", (_request, socket) => {
    socket.on("error", () => undefined);
  });
  injectWebSocket(server);
}

main().catch(async (error) => {
  log(
    "error",
    error instanceof Error ? error.message : "api failed to start",
    { stack: error instanceof Error ? error.stack : undefined },
    { telemetry: false },
  );
  try {
    const telemetry = await import("./telemetry");
    telemetry.trackProcessError("startup failed", error);
    await telemetry.stopTelemetry();
  } catch {
    // Telemetry must not block process exit.
  }
  process.exit(1);
});
