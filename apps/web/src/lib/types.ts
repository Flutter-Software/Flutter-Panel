export type ServerStatus =
  | "running"
  | "starting"
  | "stopping"
  | "offline"
  | "installing"
  | "install_failed";

export type ServerRecord = {
  id: string;
  uuid?: string;
  name: string;
  description: string;
  egg: string;
  eggId?: string;
  node: string;
  nodeId?: string;
  nodeLocation?: string;
  allocation: string;
  allocationId?: string;
  status: ServerStatus;
  owner: boolean;
  ownerId?: string;
  ownerName?: string;
  uptime: string;
  cpu: { used: number; limit: number };
  memory: { usedMb: number; limitMb: number };
  disk: { usedMb: number; limitMb: number };
  dockerImage?: string;
  startup?: string;
  stopCommand?: string;
  environment?: Record<string, string>;
  eggVariables?: { key: string; default: string; description: string }[];
  nodeOnline?: boolean;
  sftpHost?: string;
  sftpPort?: number;
  permissions?: string[];
};

export type AdminRow = {
  id: string;
  name: string;
  meta: string;
  status: string;
};

export function formatMb(value: number) {
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} GB`;
  }
  if (value > 0 && value < 10) return `${value.toFixed(1)} MB`;
  return `${Number.isInteger(value) ? value : value.toFixed(1)} MB`;
}

export function formatGiB(mb: number) {
  if (mb >= 1024) {
    const gib = mb / 1024;
    return Number.isInteger(gib) ? `${gib} GiB` : `${gib.toFixed(1)} GiB`;
  }
  return `${mb} MiB`;
}

export function formatCompact(mb: number) {
  if (mb >= 1024) {
    const gib = mb / 1024;
    const value = gib >= 10 ? gib.toFixed(0) : gib.toFixed(1);
    return `${value.replace(/\.0$/, "")}G`;
  }
  return `${mb}M`;
}
