import { Agent, setGlobalDispatcher } from "node:undici";

const panelAgent = new Agent();

let proxyBypassApplied = false;

export function bypassHttpProxyForPanel() {
  if (proxyBypassApplied) return;
  proxyBypassApplied = true;
  const extra = ["127.0.0.1", "localhost", "::1"];
  for (const key of ["NO_PROXY", "no_proxy"] as const) {
    const parts = (process.env[key] || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    process.env[key] = [...new Set([...parts, ...extra])].join(",");
  }
  setGlobalDispatcher(panelAgent);
}

export function describeFetchError(error: unknown, url: string) {
  const message = error instanceof Error ? error.message : String(error);
  const cause =
    error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const aborted = /aborted|timeout|Timeout/i.test(`${message} ${cause}`);
  if (aborted) {
    return [
      `timed out contacting ${url}`,
      "Check that the API is up: systemctl status flutter-api && curl -sS -m 3 http://127.0.0.1:4000/api/v1/health",
    ].join(". ");
  }
  return `${message}${cause ? ` (${cause})` : ""} [${url}]`;
}
