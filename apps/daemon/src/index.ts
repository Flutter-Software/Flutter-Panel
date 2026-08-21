import { mkdir } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { runConfigure } from "./configure";
import { createDaemonApp } from "./http";
import { sendHeartbeat } from "./heartbeat";

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "configure") {
    await runConfigure(argv.slice(1));
    return;
  }

  const config = await loadConfig();
  await mkdir(config.dataDir, { recursive: true });
  const { app, injectWebSocket } = createDaemonApp(config);

  const server = serve(
    { fetch: app.fetch, port: config.listenPort, hostname: config.listenHost },
    (info) => {
      console.log(
        JSON.stringify({
          level: "info",
          msg: "daemon listening",
          port: info.port,
          nodeId: config.nodeId,
          panelUrl: config.panelUrl,
          time: new Date().toISOString(),
        }),
      );
    },
  );
  injectWebSocket(server);

  const beat = async () => {
    try {
      await sendHeartbeat(config);
      console.log("[daemon] heartbeat ok");
    } catch (error) {
      console.error("[daemon] heartbeat failed:", error instanceof Error ? error.message : error);
    }
  };
  await beat();
  setInterval(() => {
    void beat();
  }, config.heartbeatMs);
}

main().catch((error) => {
  console.error("[daemon] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
