import { DAEMON_VERSION, type DaemonConfig } from "./config";

export async function sendHeartbeat(config: DaemonConfig) {
  const response = await fetch(`${config.panelUrl}/api/v1/daemon/heartbeat`, {
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
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`heartbeat HTTP ${response.status}`);
  }
}
