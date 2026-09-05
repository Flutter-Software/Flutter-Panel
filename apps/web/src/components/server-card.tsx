"use client";

import Link from "next/link";
import { formatCompact, type ServerRecord, type ServerStatus } from "@/lib/types";
import { cn } from "@/lib/cn";
import { statusMeta } from "@/components/status";
import { prefetchQuery } from "@/lib/query";
import { serverHomeHref } from "@/lib/access";

const STATUS_PILL: Record<ServerStatus, string> = {
  running: "bg-status-running/15 text-status-running",
  starting: "bg-status-warn/15 text-status-warn",
  stopping: "bg-status-warn/15 text-status-warn",
  installing: "bg-status-info/15 text-status-info",
  install_failed: "bg-status-error/15 text-status-error",
  offline: "bg-muted text-status-offline",
};

function cpuPercent(server: ServerRecord) {
  if (server.cpu.limit > 0) return Math.min(100, (server.cpu.used / server.cpu.limit) * 100);
  return Math.min(100, server.cpu.used);
}

function ramPercent(server: ServerRecord) {
  if (server.memory.limitMb <= 0) return 0;
  return Math.min(100, (server.memory.usedMb / server.memory.limitMb) * 100);
}

function diskPercent(server: ServerRecord) {
  if (server.disk.limitMb <= 0) return 0;
  return Math.min(100, (server.disk.usedMb / server.disk.limitMb) * 100);
}

function usageBar(pct: number, healthy: string) {
  if (pct >= 90) return "bg-status-error";
  if (pct >= 80) return "bg-status-warn";
  return healthy;
}

function crashNote(server: ServerRecord) {
  const exit = server.lastExit;
  if (!exit) return null;
  if (server.status !== "offline" && server.status !== "install_failed") return null;
  if (exit.kind === "killed") return null;
  if (exit.kind === "install_failed") return server.status === "install_failed" ? null : "Install failed";
  if (exit.kind === "oom") return "Ran out of memory";
  if (exit.kind === "crash") {
    return typeof exit.code === "number" ? `Exited (code ${exit.code})` : "Crashed";
  }
  return null;
}

export function serverAlerts(server: ServerRecord) {
  const alerts: { tone: "error" | "warn"; text: string }[] = [];
  if (server.nodeOnline === false) alerts.push({ tone: "error", text: "Node offline" });
  else if (server.nodeMaintenance) alerts.push({ tone: "warn", text: "Node maintenance" });
  const crash = crashNote(server);
  if (crash) alerts.push({ tone: "error", text: crash });
  const disk = diskPercent(server);
  if (disk >= 90) alerts.push({ tone: "warn", text: `Disk ${Math.round(disk)}% full` });
  if (server.status === "running") {
    const cpu = cpuPercent(server);
    const ram = ramPercent(server);
    if (cpu >= 90) alerts.push({ tone: "warn", text: `CPU ${Math.round(cpu)}%` });
    if (ram >= 90) alerts.push({ tone: "warn", text: `RAM ${Math.round(ram)}%` });
  }
  return alerts;
}

export function serverAttention(server: ServerRecord) {
  let score = 0;
  if (server.nodeOnline === false) score += 8;
  if (server.status === "install_failed") score += 6;
  if (crashNote(server)) score += 5;
  if (diskPercent(server) >= 90) score += 4;
  if (server.status === "running" && (cpuPercent(server) >= 90 || ramPercent(server) >= 90)) score += 2;
  return score;
}

export function ServerCard({ server }: { server: ServerRecord }) {
  const meta = statusMeta(server.status);
  const nodeLabel = server.nodeLocation ? `${server.node} · ${server.nodeLocation}` : server.node;
  const cpuPct = cpuPercent(server);
  const ramPct = ramPercent(server);
  const diskPct = diskPercent(server);
  const alerts = serverAlerts(server);

  return (
    <Link
      href={serverHomeHref(server)}
      onMouseEnter={() => prefetchQuery(`/api/v1/client/servers/${server.id}`)}
      onFocus={() => prefetchQuery(`/api/v1/client/servers/${server.id}`)}
      className="block rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{server.name}</p>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{server.egg}</p>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
            STATUS_PILL[server.status],
          )}
        >
          <span className={cn("size-1.5 rounded-full", meta.bar)} />
          {meta.label}
        </span>
      </div>

      {alerts.length ? (
        <ul className="mt-3 space-y-1">
          {alerts.map((alert) => (
            <li
              key={alert.text}
              className={cn(
                "text-xs font-medium",
                alert.tone === "error" ? "text-status-error" : "text-status-warn",
              )}
            >
              {alert.text}
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">Node</dt>
          <dd className="truncate font-medium">{nodeLabel}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">Address</dt>
          <dd className="truncate font-mono text-xs">{server.allocation}</dd>
        </div>
      </dl>

      <div className="mt-4 grid grid-cols-3 gap-4 border-t border-border pt-4">
        <Metric label="CPU" value={`${Math.round(server.cpu.used)}%`} pct={cpuPct} bar={usageBar(cpuPct, "bg-primary")} />
        <Metric
          label="RAM"
          value={formatCompact(server.memory.usedMb)}
          pct={ramPct}
          bar={usageBar(ramPct, "bg-status-running")}
        />
        <Metric
          label="DISK"
          value={formatCompact(server.disk.usedMb)}
          pct={diskPct}
          bar={usageBar(diskPct, "bg-status-warn")}
        />
      </div>
    </Link>
  );
}

function Metric({
  label,
  value,
  pct,
  bar,
}: {
  label: string;
  value: string;
  pct: number;
  bar: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-1 text-[11px]">
        <span className="font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground">{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ServerTable({ servers }: { servers: ServerRecord[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 font-medium">Server</th>
            <th className="px-4 py-2.5 font-medium">Egg</th>
            <th className="px-4 py-2.5 font-medium">Node</th>
            <th className="px-4 py-2.5 font-medium">Network</th>
            <th className="px-4 py-2.5 font-medium">Resources</th>
          </tr>
        </thead>
        <tbody>
          {servers.map((server) => {
            const meta = statusMeta(server.status);
            const nodeLabel = server.nodeLocation
              ? `${server.node} · ${server.nodeLocation}`
              : server.node;
            const alerts = serverAlerts(server);
            return (
              <tr key={server.id} className="border-t border-border hover:bg-muted/40">
                <td className="px-4 py-3">
                  <Link
                    href={serverHomeHref(server)}
                    onMouseEnter={() => prefetchQuery(`/api/v1/client/servers/${server.id}`)}
                    className="font-medium hover:text-primary"
                  >
                    {server.name}
                  </Link>
                  <div className={cn("mt-0.5 text-xs", meta.className)}>{meta.label}</div>
                  {alerts.length ? (
                    <p
                      className={cn(
                        "mt-0.5 text-xs",
                        alerts[0]?.tone === "error" ? "text-status-error" : "text-status-warn",
                      )}
                    >
                      {alerts.map((alert) => alert.text).join(" · ")}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{server.egg}</td>
                <td className="px-4 py-3 text-muted-foreground">{nodeLabel}</td>
                <td className="px-4 py-3 font-mono text-xs">{server.allocation}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  CPU {Math.round(server.cpu.used)}% · {formatCompact(server.memory.usedMb)} ·{" "}
                  {formatCompact(server.disk.usedMb)} disk
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
