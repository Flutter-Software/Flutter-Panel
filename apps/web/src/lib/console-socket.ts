function isLoopbackHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/** Prefer a reachable API socket. Never send a remote browser to 127.0.0.1. */
export function browserConsoleSocketUrl(token: string, advertised?: string) {
  const query = `token=${encodeURIComponent(token)}`;
  const pageLoopback = isLoopbackHost(window.location.hostname);
  const pagePort = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
  // Next.js dev rewrites HTTP /api but does not reliably proxy WebSockets.
  if (pageLoopback && window.location.protocol === "http:" && pagePort === "3010") {
    return `ws://${window.location.hostname}:4000/api/v1/ws/console?${query}`;
  }
  const sameOrigin = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/v1/ws/console?${query}`;
  if (!advertised) return sameOrigin;
  try {
    const url = new URL(advertised);
    const advertisedLoopback = isLoopbackHost(url.hostname);
    if (advertisedLoopback && !pageLoopback) return sameOrigin;
    if (window.location.protocol === "https:" && url.protocol !== "wss:") return sameOrigin;
    url.searchParams.set("token", token);
    return url.toString();
  } catch {
    return sameOrigin;
  }
}
