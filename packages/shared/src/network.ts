/**
 * Host reachability helpers.
 *
 * The panel hands addresses to people outside the machine it runs on (SFTP
 * clients, browsers). An address is only useful to them when it is publicly
 * routable, so anything loopback, private (RFC 1918), link-local, CGNAT,
 * reserved, or a LAN-only name must never be advertised.
 *
 * These checks are purely syntactic: no DNS lookup is made. A public-looking
 * hostname that resolves to a private address cannot be detected here.
 */

/** Hostname suffixes that only resolve inside a private network. */
const PRIVATE_NAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".home.arpa",
  ".corp",
  ".private",
  ".test",
  ".example",
  ".invalid",
];

/**
 * Reduce whatever an admin typed into a host field to a bare host.
 *
 * Accepts `host`, `host:port`, `scheme://host:port/path`, `[v6]`, `[v6]:port`
 * and bare IPv6. Returns the lowercase host with no scheme, port, path,
 * brackets, IPv6 zone id, or trailing dot. Returns "" when nothing usable is
 * left.
 */
export function bareHost(value: string | null | undefined): string {
  let host = String(value ?? "").trim().toLowerCase();
  if (!host) return "";

  // scheme://user@host:port/path -> host:port
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.split(/[/?#]/)[0] ?? "";
  host = host.slice(host.lastIndexOf("@") + 1);

  if (host.startsWith("[")) {
    // [v6] or [v6]:port
    const end = host.indexOf("]");
    host = end >= 0 ? host.slice(1, end) : host.slice(1);
  } else if (host.split(":").length === 2) {
    // Exactly one colon is host:port. Two or more is a bare IPv6 address.
    host = host.split(":")[0] ?? "";
  }

  // fe80::1%eth0 -> fe80::1
  host = host.split("%")[0] ?? "";
  return host.replace(/\.+$/, "");
}

/** Parse a strict dotted-quad IPv4 address into its four octets. */
function ipv4Octets(host: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  return octets as [number, number, number, number];
}

/** True when the IPv4 address is globally routable unicast. */
function isPublicIpv4([a, b, c]: [number, number, number, number]): boolean {
  if (a === 0) return false; // 0.0.0.0/8 "this network"
  if (a === 10) return false; // 10.0.0.0/8 private
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 CGNAT / Tailscale
  if (a === 127) return false; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return false; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return false; // 192.168.0.0/16 private
  if (a === 192 && b === 0 && c === 0) return false; // 192.0.0.0/24 IETF protocol
  if (a === 192 && b === 0 && c === 2) return false; // 192.0.2.0/24 documentation
  if (a === 198 && (b === 18 || b === 19)) return false; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // 198.51.100.0/24 documentation
  if (a === 203 && b === 0 && c === 113) return false; // 203.0.113.0/24 documentation
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/**
 * Expand an IPv6 address into its eight 16-bit groups.
 * Handles `::` compression and a trailing embedded IPv4 (`::ffff:1.2.3.4`).
 */
function ipv6Groups(host: string): number[] | null {
  if (!host.includes(":") || !/^[0-9a-f:.]+$/.test(host)) return null;

  let text = host;
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    // Rewrite the embedded IPv4 tail as two hex groups.
    const v4 = ipv4Octets(tail);
    if (!v4) return null;
    const high = ((v4[0] << 8) | v4[1]).toString(16);
    const low = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(":") : []);
  const head = parse(halves[0] ?? "");
  const rest = halves.length === 2 ? parse(halves[1] ?? "") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;

  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

/** True when the IPv6 address is globally routable unicast. */
function isPublicIpv6(groups: number[]): boolean {
  const first = groups[0] ?? 0;
  const leadingZeros = groups.slice(0, 5).every((group) => group === 0);

  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d: judge the embedded IPv4.
  // This also covers :: (unspecified) and ::1 (loopback), which map to 0.0.0.x.
  if (leadingZeros && (groups[5] === 0xffff || groups[5] === 0)) {
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;
    return isPublicIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local (deprecated)
  if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (first === 0x2001 && groups[1] === 0x0db8) return false; // 2001:db8::/32 documentation
  return true;
}

/**
 * True when `value` is a host that someone on the public internet could
 * plausibly connect to: a globally routable IP address, or a fully qualified
 * DNS name that is not reserved for private use.
 *
 * Loopback, private, link-local, CGNAT, documentation and multicast addresses
 * are rejected, as are `localhost`, single-label names (`nas`, `node1`) and
 * private suffixes such as `.local` and `.lan`.
 */
export function isPublicHost(value: string | null | undefined): boolean {
  const host = bareHost(value);
  if (!host) return false;

  const v6 = ipv6Groups(host);
  if (v6) return isPublicIpv6(v6);
  if (host.includes(":")) return false; // malformed IPv6

  const v4 = ipv4Octets(host);
  if (v4) return isPublicIpv4(v4);
  // Digits and dots only but not a dotted quad ("127.1", "2130706433"): these
  // are legacy IPv4 spellings, commonly of loopback. Never treat as public.
  if (/^[\d.]+$/.test(host)) return false;

  if (host === "localhost") return false;
  if (!host.includes(".")) return false; // single-label names are LAN-only
  if (PRIVATE_NAME_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;

  // Must be a syntactically valid DNS name with an alphabetic TLD.
  return /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z][a-z0-9-]*[a-z0-9]$/.test(host);
}

/**
 * Wrap a bare host for use in a `host:port` pair or URL authority.
 * IPv6 literals need brackets (`[2001:db8::1]:2022`); everything else is
 * returned unchanged.
 */
export function hostForAuthority(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
