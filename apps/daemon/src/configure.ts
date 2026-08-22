import { defaultConfigPath, writeDaemonConfig } from "./config";

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

  if (!panelUrl || !token || !nodeId) {
    throw new Error(
      "Usage: npm run daemon:configure -- --panel-url http://127.0.0.1:4000 --token flt_… --node <id>",
    );
  }

  const url = new URL("/api/v1/daemon/configuration", `${panelUrl}/`);
  url.searchParams.set("nodeId", nodeId);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const json = (await response.json().catch(() => ({}))) as {
    data?: {
      panelUrl?: string;
      nodeId?: string;
      listenHost?: string;
      listenPort?: number;
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
  const written = await writeDaemonConfig(
    {
      panelUrl: json.data.panelUrl || panelUrl,
      nodeId: json.data.nodeId || nodeId,
      token,
      requestSecret: json.data.requestSecret,
      listenHost: readFlag(argv, "--host") || json.data.listenHost || "0.0.0.0",
      listenPort: port,
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
