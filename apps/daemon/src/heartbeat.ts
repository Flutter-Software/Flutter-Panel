import { DAEMON_VERSION, type DaemonConfig, readDaemonConfigFile, writeDaemonConfig } from "./config";
import { describeFetchError } from "./panel-fetch";
import os from "node:os";

function trimUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function isLoopbackUrl(value: string) {
  try {
    const host = new URL(value).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

export function panelUrlCandidates(config: DaemonConfig) {
  const urls = [
    config.panelUrl,
    process.env.PANEL_URL,
    process.env.APP_URL,
    process.env.API_INTERNAL_URL,
    "http://127.0.0.1:4000",
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of urls) {
    const url = trimUrl(raw?.trim() || "");
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result.sort((a, b) => Number(isLoopbackUrl(a)) - Number(isLoopbackUrl(b)));
}

async function persistPanelUrl(panelUrl: string) {
  const file = await readDaemonConfigFile();
  if (!file || file.panelUrl === panelUrl) return;
  await writeDaemonConfig({ ...file, panelUrl });
}

async function postHeartbeat(config: DaemonConfig, panelUrl: string, timeoutMs: number) {
  const url = `${trimUrl(panelUrl)}/api/v1/daemon/heartbeat`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.daemonToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        nodeId: config.nodeId,
        listenUrl: config.listenUrl,
        version: DAEMON_VERSION,
        system: {
          hostname: os.hostname(),
          platform: os.platform(),
          release: os.release(),
          arch: os.arch(),
          cpuThreads: os.cpus().length,
          totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(describeFetchError(error, url));
  }
  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(json.error?.message || `heartbeat HTTP ${response.status} from ${url}`);
  }
}

export async function sendHeartbeat(config: DaemonConfig) {
  const errors: string[] = [];
  for (const panelUrl of panelUrlCandidates(config)) {
    try {
      await postHeartbeat(config, panelUrl, isLoopbackUrl(panelUrl) ? 4_000 : 12_000);
      if (panelUrl !== config.panelUrl) {
        config.panelUrl = panelUrl;
        console.log(`[daemon] switched panel URL to ${panelUrl}`);
        void persistPanelUrl(panelUrl).catch(() => undefined);
      }
      return;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(errors.join(" | "));
}
