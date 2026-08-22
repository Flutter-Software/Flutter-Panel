function isLoopbackHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/** Prefer same-origin so nginx can upgrade the socket. Never use 127.0.0.1 from a remote browser. */
export function browserConsoleSocketUrl(token: string, advertised?: string) {
  const query = `token=${encodeURIComponent(token)}`;
  const sameOrigin = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/v1/ws/console?${query}`;
  if (!advertised) return sameOrigin;
  try {
    const url = new URL(advertised);
    const advertisedLoopback = isLoopbackHost(url.hostname);
    const pageLoopback = isLoopbackHost(window.location.hostname);
    if (advertisedLoopback && !pageLoopback) return sameOrigin;
    if (window.location.protocol === "https:" && url.protocol !== "wss:") return sameOrigin;
    url.searchParams.set("token", token);
    return url.toString();
  } catch {
    return sameOrigin;
  }
}
