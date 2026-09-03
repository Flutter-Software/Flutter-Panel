import { mkdir } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { runConfigure } from "./configure";
import { createDaemonApp } from "./http";
import { sendHeartbeat } from "./heartbeat";
import { bypassHttpProxyForPanel } from "./panel-fetch";
import { hydrateProcessStates, recoverInstallJobs } from "./docker";
import { startSftp } from "./sftp";
import { setPanelStateReporter } from "./process-state";
import { reportServerState } from "./panel-state";

async function main() {
  bypassHttpProxyForPanel();
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
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `[daemon] fatal: port ${config.listenPort} is already in use. Stop the other process, then start once:`,
      );
      console.error(`  sudo systemctl stop flutter-daemon`);
      console.error(`  sudo fuser -k ${config.listenPort}/tcp`);
      console.error(`  sudo systemctl start flutter-daemon`);
    } else {
      console.error("[daemon] fatal:", error.message);
    }
    process.exit(1);
  });
  injectWebSocket(server);

  try {
    await startSftp(config);
  } catch (error) {
    console.error("[daemon] sftp failed to listen:", error instanceof Error ? error.message : error);
  }

  setPanelStateReporter((uuid, state) => {
    void reportServerState(config, uuid, { status: state });
  });
  await recoverInstallJobs(config).catch((error) => {
    console.error("[daemon] recover installs failed:", error instanceof Error ? error.message : error);
  });
  await hydrateProcessStates(config).catch((error) => {
    console.error("[daemon] hydrate states failed:", error instanceof Error ? error.message : error);
  });

  const beat = async () => {
    try {
      await sendHeartbeat(config);
      console.log("[daemon] heartbeat ok");
      return true;
    } catch (error) {
      console.error("[daemon] heartbeat failed:", error instanceof Error ? error.message : error);
      return false;
    }
  };
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    if (await beat()) break;
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
  }
  setInterval(() => {
    void beat();
  }, config.heartbeatMs);
}

main().catch((error) => {
  console.error("[daemon] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
