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
import { clearDaemonPid, reclaimPreviousDaemon, writeDaemonPid } from "./process-lock";

type Closeable = {
  close: (callback?: (error?: Error) => void) => void;
  closeAllConnections?: () => void;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listenHttp(app: { fetch: (...args: never[]) => unknown }, host: string, port: number): Promise<Closeable> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch as never, port, hostname: host }, () => {
      server.off("error", onError);
      resolve(server as unknown as Closeable);
    });
    const onError = (error: Error) => {
      server.close();
      reject(error);
    };
    server.once("error", onError);
  });
}

async function listenHttpRetry(
  app: { fetch: (...args: never[]) => unknown },
  host: string,
  port: number,
  dataDir: string,
) {
  let last: unknown;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      return await listenHttp(app, host, port);
    } catch (error) {
      last = error;
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code !== "EADDRINUSE" || attempt === 10) break;
      console.warn(`[daemon] port ${port} is busy, retrying (${attempt}/9)…`);
      await reclaimPreviousDaemon(dataDir, [port]);
      await sleep(350 * attempt);
    }
  }
  throw last;
}

function closeQuiet(server: Closeable | null) {
  if (!server) return;
  try {
    server.closeAllConnections?.();
  } catch {
    /* ignore */
  }
  try {
    server.close();
  } catch {
    /* ignore */
  }
}

async function main() {
  bypassHttpProxyForPanel();
  const argv = process.argv.slice(2);
  if (argv[0] === "configure") {
    await runConfigure(argv.slice(1));
    return;
  }

  const config = await loadConfig();
  await mkdir(config.dataDir, { recursive: true });
  await reclaimPreviousDaemon(config.dataDir, [config.listenPort, config.sftpPort]);
  await sleep(250);
  await writeDaemonPid(config.dataDir);

  const { app, injectWebSocket } = createDaemonApp(config);
  let http: Closeable | null = null;
  let sftp: Closeable | null = null;
  let beats: ReturnType<typeof setInterval> | null = null;
  let stopping = false;

  async function shutdown() {
    if (stopping) return;
    stopping = true;
    if (beats) clearInterval(beats);
    closeQuiet(http);
    closeQuiet(sftp);
    await clearDaemonPid(config.dataDir);
    process.exit(0);
  }

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGHUP", () => void shutdown());

  try {
    http = await listenHttpRetry(app, config.listenHost, config.listenPort, config.dataDir);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    await clearDaemonPid(config.dataDir);
    if (code === "EADDRINUSE") {
      console.error(
        `[daemon] fatal: port ${config.listenPort} is already in use. Stop the other process, then start once.`,
      );
    } else {
      console.error("[daemon] fatal:", error instanceof Error ? error.message : error);
    }
    process.exit(1);
  }

  console.log(
    JSON.stringify({
      level: "info",
      msg: "daemon listening",
      port: config.listenPort,
      nodeId: config.nodeId,
      panelUrl: config.panelUrl,
      time: new Date().toISOString(),
    }),
  );
  injectWebSocket(http as Parameters<typeof injectWebSocket>[0]);

  try {
    sftp = await startSftp(config);
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
    if (attempt < 5) await sleep(2_000 * attempt);
  }
  beats = setInterval(() => {
    void beat();
  }, config.heartbeatMs);
}

main().catch((error) => {
  console.error("[daemon] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
