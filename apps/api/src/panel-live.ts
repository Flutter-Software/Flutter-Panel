import { isNodeOnline } from "./nodes";
import { Node, Server } from "./db/models";
import { forgetLiveStats, statsForServers } from "./daemon";
import { panelHealth } from "./health";
import {
  onPanelSubscribe,
  panelHasAdmins,
  panelHasSubscribers,
  pingPanelSessions,
  publish,
  publishServerStatus,
  refreshPanelMembership,
  rememberNodeOnline,
  subscribedServerIds,
} from "./panel-hub";
import { readUpdateJob } from "./update";
import type { ServerStatus } from "@flutter-software/shared";

const STATS_MS = 2_000;
const NODE_MS = 5_000;
const MEMBER_MS = 20_000;
const HEALTH_MS = 15_000;
const UPDATE_MS = 1_500;
const PING_MS = 20_000;

type StatsKey = string;
const lastStats = new Map<StatsKey, string>();
let lastUpdateKey = "";
let started = false;

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

async function tickStats() {
  if (!panelHasSubscribers()) return;
  const ids = subscribedServerIds();
  if (!ids.length) return;
  const rows = await Server.find({ _id: { $in: ids } }, { uuid: 1, nodeId: 1, status: 1, lastExit: 1 });
  const targets = rows.filter(
    (row) => row.status !== "installing" && row.status !== "install_failed" && row.uuid && row.nodeId,
  );
  if (!targets.length) return;
  const live = await statsForServers(
    targets.map((row) => ({ nodeId: row.nodeId.toString(), uuid: row.uuid })),
  );
  for (const row of targets) {
    const id = row._id.toString();
    const sample = live.get(row.uuid);
    if (!sample) continue;
    let status = String(row.status || "offline");
    let cpu = 0;
    let memoryMb = 0;
    const diskMb =
      typeof sample.diskBytes === "number" && sample.diskBytes > 0
        ? round1(sample.diskBytes / 1024 / 1024)
        : 0;
    if (sample.stats) {
      if (typeof sample.stats.cpuPercent === "number") cpu = round1(sample.stats.cpuPercent);
      if (typeof sample.stats.memoryBytes === "number") {
        memoryMb = round1(sample.stats.memoryBytes / 1024 / 1024);
      }
    }
    if (sample.running === true && (status === "offline" || status === "starting")) {
      status = "running";
    } else if (sample.running === false && (status === "running" || status === "stopping")) {
      status = "offline";
      cpu = 0;
      memoryMb = 0;
    }
    if (status !== row.status) {
      forgetLiveStats(row.uuid);
      void Server.updateOne({ _id: row._id }, { $set: { status } }).catch(() => undefined);
      publishServerStatus({ id, status, lastExit: row.lastExit });
    }
    const key = `${id}:${status}:${cpu}:${memoryMb}:${diskMb}`;
    if (lastStats.get(id) === key) continue;
    lastStats.set(id, key);
    publish({
      event: "server.stats",
      data: {
        id,
        cpu,
        memoryMb,
        diskMb,
        status: status as ServerStatus,
        uptime: status === "running" ? "Running" : status === "installing" ? "Installing" : "Offline",
      },
    });
  }
}

async function tickNodes() {
  if (!panelHasAdmins()) return;
  const rows = await Node.find({}, { lastHeartbeatAt: 1, maintenanceMode: 1, daemonVersion: 1, daemonListenUrl: 1 });
  for (const row of rows) {
    const id = row._id.toString();
    const online = isNodeOnline(row.lastHeartbeatAt);
    if (!rememberNodeOnline(id, online)) continue;
    publish({
      event: "node.status",
      data: {
        id,
        online,
        lastHeartbeatAt: row.lastHeartbeatAt ? new Date(row.lastHeartbeatAt).toISOString() : null,
        maintenanceMode: Boolean(row.maintenanceMode),
        daemonVersion: row.daemonVersion || null,
        daemonListenUrl: row.daemonListenUrl ?? null,
      },
    });
  }
}

async function tickHealth() {
  if (!panelHasAdmins()) return;
  publish({ event: "health", data: await panelHealth() });
}

async function tickUpdate() {
  if (!panelHasAdmins()) return;
  const job = await readUpdateJob();
  const key = `${job.state}:${job.log.length}:${job.error ?? ""}:${job.finishedAt ?? ""}`;
  if (key === lastUpdateKey) return;
  lastUpdateKey = key;
  publish({ event: "update.job", data: job });
}

export function startPanelLive() {
  if (started) return;
  started = true;
  onPanelSubscribe(() => {
    void tickStats();
    void tickNodes();
    void tickHealth();
    void tickUpdate();
  });
  setInterval(() => void tickStats(), STATS_MS);
  setInterval(() => void tickNodes(), NODE_MS);
  setInterval(() => void refreshPanelMembership(), MEMBER_MS);
  setInterval(() => void tickHealth(), HEALTH_MS);
  setInterval(() => void tickUpdate(), UPDATE_MS);
  setInterval(() => pingPanelSessions(), PING_MS);
}
