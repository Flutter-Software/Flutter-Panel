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
  try {
    await connectRedis();
  } catch (error) {
    log("warn", "redis unavailable", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }
  const { app, injectWebSocket } = createApp();
  const server = serve({ fetch: app.fetch, port: env().PORT, hostname: env().HOST }, (info) => {
    log("info", "api listening", { host: env().HOST, port: info.port });
  });
  injectWebSocket(server);
}

main().catch((error) => {
  log("error", error instanceof Error ? error.message : "api failed to start");
  process.exit(1);
});
