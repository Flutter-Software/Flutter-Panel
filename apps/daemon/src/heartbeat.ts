import { DAEMON_VERSION, type DaemonConfig } from "./config";
import { describeFetchError } from "./panel-fetch";

export async function sendHeartbeat(config: DaemonConfig) {
  const url = `${config.panelUrl}/api/v1/daemon/heartbeat`;
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
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Error(describeFetchError(error, url));
  }
  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(json.error?.message || `heartbeat HTTP ${response.status} from ${url}`);
  }
}
