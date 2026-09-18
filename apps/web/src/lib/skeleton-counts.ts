export const SKELETON_COUNTS_COOKIE = "fp-skel";

const MAX_ITEMS = 24;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export type SkeletonCounts = {
  clientServers?: number;
  clientShared?: number;
  adminServers?: number;
  adminNodes?: number;
  adminUsers?: number;
  adminLocations?: number;
  adminNests?: number[];
  adminHosts?: number;
};

export function clampSkeletonCount(value: number | undefined, fallback = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(MAX_ITEMS, Math.floor(value)));
}

export function parseSkeletonCounts(raw: string | undefined): SkeletonCounts {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const row = parsed as Record<string, unknown>;
    return {
      clientServers: numberOrUndef(row.clientServers),
      clientShared: numberOrUndef(row.clientShared),
      adminServers: numberOrUndef(row.adminServers),
      adminNodes: numberOrUndef(row.adminNodes),
      adminUsers: numberOrUndef(row.adminUsers),
      adminLocations: numberOrUndef(row.adminLocations),
      adminNests: nestCounts(row.adminNests),
      adminHosts: numberOrUndef(row.adminHosts),
    };
  } catch {
    return {};
  }
}

export function rememberSkeletonCounts(patch: SkeletonCounts) {
  if (typeof document === "undefined") return;
  const next = { ...readSkeletonCounts(), ...patch };
  document.cookie = `${SKELETON_COUNTS_COOKIE}=${encodeURIComponent(JSON.stringify(next))}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function readSkeletonCounts(): SkeletonCounts {
  if (typeof document === "undefined") return {};
  const match = document.cookie.match(new RegExp(`(?:^|; )${SKELETON_COUNTS_COOKIE}=([^;]*)`));
  return parseSkeletonCounts(match?.[1]);
}

export function rememberListCounts(path: string, json: unknown) {
  if (!json || typeof json !== "object" || !("data" in json)) return;
  const data = (json as { data: Record<string, unknown> }).data;
  if (!data || typeof data !== "object") return;

  if (path === "/api/v1/client/servers") {
    const servers = arrayOfRecords(data.servers);
    rememberSkeletonCounts({
      clientServers: servers.filter((row) => row.owner).length,
      clientShared: servers.filter((row) => !row.owner).length,
    });
    return;
  }
  if (path === "/api/v1/admin/servers") {
    rememberSkeletonCounts({ adminServers: arrayOfRecords(data.servers).length });
    return;
  }
  if (path === "/api/v1/admin/nodes") {
    rememberSkeletonCounts({ adminNodes: arrayOfRecords(data.nodes).length });
    return;
  }
  if (path === "/api/v1/admin/users") {
    rememberSkeletonCounts({ adminUsers: arrayOfRecords(data.users).length });
    return;
  }
  if (path === "/api/v1/admin/locations") {
    rememberSkeletonCounts({ adminLocations: arrayOfRecords(data.locations).length });
    return;
  }
  if (path === "/api/v1/admin/database-hosts") {
    rememberSkeletonCounts({ adminHosts: arrayOfRecords(data.hosts).length });
    return;
  }
  if (path === "/api/v1/admin/nests") {
    rememberSkeletonCounts({
      adminNests: arrayOfRecords(data.nests).map((nest) => {
        if (typeof nest.eggCount === "number") return nest.eggCount;
        return Array.isArray(nest.eggs) ? nest.eggs.length : 0;
      }),
    });
  }
}

function numberOrUndef(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nestCounts(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value
    .slice(0, MAX_ITEMS)
    .map((entry) => (typeof entry === "number" && Number.isFinite(entry) ? Math.max(0, Math.floor(entry)) : 0));
}

function arrayOfRecords(value: unknown) {
  if (!Array.isArray(value)) return [] as Record<string, unknown>[];
  return value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
}
