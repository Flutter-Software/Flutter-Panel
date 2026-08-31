import type { DaemonConfig } from "./config";
import { panelUrlCandidates } from "./heartbeat";
import { describeFetchError } from "./panel-fetch";
import type { ProcessState } from "./process-state";

export type ServerStatePayload = {
  status?: ProcessState;
  install?: { ok: boolean; error?: string };
};

function trimUrl(value: string) {
  return value.replace(/\/+$/, "");
}

async function postState(config: DaemonConfig, panelUrl: string, uuid: string, payload: ServerStatePayload) {
  const url = `${trimUrl(panelUrl)}/api/v1/daemon/servers/${uuid}/state`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.daemonToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ nodeId: config.nodeId, ...payload }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    throw new Error(describeFetchError(error, url));
  }
  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(json.error?.message || `state HTTP ${response.status} from ${url}`);
  }
}

export async function reportServerState(config: DaemonConfig, uuid: string, payload: ServerStatePayload) {
  const errors: string[] = [];
  for (const panelUrl of panelUrlCandidates(config)) {
    try {
      await postState(config, panelUrl, uuid, payload);
      return;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  console.error("[daemon] state callback failed:", errors.join(" | "));
}
