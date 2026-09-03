import { defaultConfigPath, writeDaemonConfig } from "./config";
import { describeFetchError } from "./panel-fetch";

function readFlag(argv: string[], name: string) {
  const index = argv.indexOf(name);
  if (index < 0 || index + 1 >= argv.length) return "";
  return argv[index + 1].trim();
}

export async function runConfigure(argv: string[]) {
  const panelUrl = readFlag(argv, "--panel-url").replace(/\/+$/, "");
  const token = readFlag(argv, "--token");
  const nodeId = readFlag(argv, "--node");
  const configPath = readFlag(argv, "--config") || defaultConfigPath();
  const listenPortRaw = readFlag(argv, "--port");
  const listenPort = listenPortRaw ? Number(listenPortRaw) : 8080;
  const sftpPortRaw = readFlag(argv, "--sftp-port");

  if (!panelUrl || !token || !nodeId) {
    throw new Error(
      "Usage: npm run daemon:configure -- --panel-url https://panel.example.com --token <flt_token> --node <id>",
    );
  }

  if (/[^\u0020-\u007E]/.test(token) || token.includes("...") || token === "flt_" || token.length < 20) {
    throw new Error(
      "That --token is not a real daemon token. Copy the full flt_ value from Admin → Nodes (clipboard button), not the docs placeholder.",
    );
  }

  const url = new URL("/api/v1/daemon/configuration", `${panelUrl}/`);
  url.searchParams.set("nodeId", nodeId);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Error(describeFetchError(error, url.toString()));
  }
  const json = (await response.json().catch(() => ({}))) as {
    data?: {
      panelUrl?: string;
      nodeId?: string;
      listenHost?: string;
      listenPort?: number;
      sftpPort?: number;
      listenUrl?: string;
      dataDir?: string;
      requestSecret?: string;
    };
    error?: { message?: string };
  };

  if (!response.ok || !json.data?.requestSecret) {
    throw new Error(`Configure failed: ${json.error?.message || `HTTP ${response.status}`}`);
  }

  const port = Number.isInteger(listenPort) ? listenPort : json.data.listenPort || 8080;
  const sftpPort = sftpPortRaw ? Number(sftpPortRaw) : json.data.sftpPort || 2022;
  const written = await writeDaemonConfig(
    {
      panelUrl,
      nodeId: json.data.nodeId || nodeId,
      token,
      requestSecret: json.data.requestSecret,
      listenHost: readFlag(argv, "--host") || json.data.listenHost || "0.0.0.0",
      listenPort: port,
      sftpPort: Number.isInteger(sftpPort) ? sftpPort : 2022,
      listenUrl: readFlag(argv, "--listen-url") || json.data.listenUrl || `http://127.0.0.1:${port}`,
      dataDir: readFlag(argv, "--data-dir") || json.data.dataDir || "./data",
    },
    configPath,
  );
  console.log(`[daemon] wrote ${written}`);
  console.log("[daemon] This only saved the config. Start the daemon next:");
  console.log("  npm run dev:daemon");
  console.log("  # production: sudo systemctl enable --now flutter-daemon");
}
