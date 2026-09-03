import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PANEL_VERSION } from "@flutter-software/shared";

export const DAEMON_VERSION = PANEL_VERSION;

export type DaemonConfig = {
  panelUrl: string;
  nodeId: string;
  daemonToken: string;
  requestSecret: string;
  listenHost: string;
  listenPort: number;
  listenUrl: string;
  dataDir: string;
  heartbeatMs: number;
  sftpPort: number;
};

export type DaemonFileConfig = {
  panelUrl: string;
  nodeId: string;
  token: string;
  requestSecret: string;
  listenHost: string;
  listenPort: number;
  listenUrl: string;
  dataDir: string;
  sftpPort?: number;
};

export function defaultConfigPath() {
  return resolve(process.env.DAEMON_CONFIG || resolve(process.cwd(), "data/config.json"));
}

export async function writeDaemonConfig(file: DaemonFileConfig, configPath = defaultConfigPath()) {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  return configPath;
}

export async function readDaemonConfigFile(configPath = defaultConfigPath()): Promise<DaemonFileConfig | null> {
  try {
    const raw = await readFile(configPath, "utf8");
    return JSON.parse(raw) as DaemonFileConfig;
  } catch {
    return null;
  }
}

function env(key: string) {
  return process.env[key]?.trim() || "";
}

function parsePort(raw: string | undefined, fallback: number) {
  const parsed = raw ? Number(raw) : fallback;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return fallback;
  return parsed;
}

export async function loadConfig(): Promise<DaemonConfig> {
  const file = await readDaemonConfigFile();
  const fileUrl = (file?.panelUrl || "").replace(/\/+$/, "");
  const appUrl = env("APP_URL").replace(/\/+$/, "");
  // systemd unit env wins over config.json so a tunnel URL can change without
  // rewriting the file the installer generated.
  const panelUrl = (
    env("PANEL_URL") ||
    fileUrl ||
    appUrl ||
    env("API_INTERNAL_URL") ||
    "http://127.0.0.1:4000"
  ).replace(/\/+$/, "");
  const nodeId = env("DAEMON_NODE_ID") || file?.nodeId || "";
  const daemonToken = env("DAEMON_TOKEN") || file?.token || "";
  const requestSecret = env("DAEMON_REQUEST_SECRET") || file?.requestSecret || "";
  const listenPort = parsePort(process.env.DAEMON_PORT, file?.listenPort ?? 8080);
  const listenHost = env("DAEMON_LISTEN_HOST") || file?.listenHost || "0.0.0.0";
  const listenUrl = (
    env("DAEMON_LISTEN_URL") ||
    file?.listenUrl ||
    `http://127.0.0.1:${listenPort}`
  ).replace(/\/+$/, "");
  const dataDir = resolve(env("DAEMON_DATA_DIR") || file?.dataDir || resolve(process.cwd(), "data"));
  const heartbeatMs = Number(process.env.DAEMON_HEARTBEAT_MS ?? 15_000);
  const sftpPort = parsePort(process.env.DAEMON_SFTP_PORT, file?.sftpPort ?? 2022);

  if (!panelUrl || !nodeId || !daemonToken || !requestSecret) {
    throw new Error(
      [
        "Daemon is not configured.",
        "Run: npm run daemon:configure -- --panel-url https://panel.example.com --token <flt_token> --node <id>",
      ].join("\n"),
    );
  }

  return {
    panelUrl,
    nodeId,
    daemonToken,
    requestSecret,
    listenHost,
    listenPort,
    listenUrl,
    dataDir,
    heartbeatMs: Number.isFinite(heartbeatMs) && heartbeatMs >= 5_000 ? heartbeatMs : 15_000,
    sftpPort,
  };
}
