export function parsePortSpec(raw: string): { ok: true; ports: number[] } | { ok: false; error: string } {
  const ports = new Set<number>();
  for (const part of raw.split(/[,\s]+/).filter(Boolean)) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 65535 || start > end) {
        return { ok: false, error: "Invalid port range" };
      }
      if (end - start > 256) return { ok: false, error: "Port range cannot exceed 256 ports" };
      for (let port = start; port <= end; port += 1) ports.add(port);
      continue;
    }
    const port = Number(part);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: `Invalid port: ${part}` };
    }
    ports.add(port);
  }
  if (!ports.size) return { ok: false, error: "At least one port is required" };
  return { ok: true, ports: [...ports] };
}
