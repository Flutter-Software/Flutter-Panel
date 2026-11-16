"use client";

import Link from "next/link";
import { formatCompact, type ServerRecord } from "@/lib/types";
import { cn } from "@/lib/cn";
import { LedRail, statusMeta } from "@/components/status";
import { prefetchQuery } from "@/lib/query";
import { serverHomeHref } from "@/lib/access";

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

/**
 * One server as a rack row (DESIGN.md → Layout grammar → Rack).
 *
 *   ▌● Survival      us-east-1 (nyc)   play.example:25565   CPU ▂▂  RAM ▂▂▂  Disk ▂   Running
 *     Paper
 *
 * The LED rail on the left edge is the status; everything else stays quiet.
 * On narrow screens the columns wrap under the name.
 */
export const SERVER_RACK_COLUMNS =
  "lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.2fr)_repeat(3,5.75rem)_7rem] lg:items-center lg:gap-5";

/** Column legend shown above the rows on wide screens, so the numbers read like a table. */
export function ServerRackHeader() {
  return (
    <div
      aria-hidden
      className={cn("hidden px-4 py-2 text-[12px] text-muted-foreground", SERVER_RACK_COLUMNS)}
    >
      <span className="pl-1">Server</span>
      <span>Node</span>
      <span>Address</span>
      <span>CPU</span>
      <span>Memory</span>
      <span>Disk</span>
      <span>Status</span>
    </div>
  );
}

export function ServerCard({ server }: { server: ServerRecord }) {
  const meta = statusMeta(server.status);
  const cpuPct = cpuPercent(server);
  const ramPct = ramPercent(server);
  const diskPct = diskPercent(server);
  const alerts = serverAlerts(server);
  const live = server.status === "running";

  return (
    <Link
      role="listitem"
      href={serverHomeHref(server)}
      onMouseEnter={() => prefetchQuery(`/api/v1/client/servers/${server.id}`)}
      onFocus={() => prefetchQuery(`/api/v1/client/servers/${server.id}`)}
      className={cn(
        "relative flex flex-col gap-2 px-4 py-3.5 outline-none hover:bg-muted/45 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        SERVER_RACK_COLUMNS,
      )}
    >
      <LedRail status={server.status} />

      <div className="min-w-0 pl-1">
        <p className="truncate font-display text-[18px] font-semibold leading-tight">{server.name}</p>
        <p className="truncate text-[13px] text-muted-foreground">{server.egg}</p>
        {alerts.length ? (
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {alerts.map((alert) => (
              <li
                key={alert.text}
                className={cn(
                  "text-[12px] font-medium",
                  alert.tone === "error" ? "text-status-error" : "text-status-warn",
                )}
              >
                {alert.text}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <p className="min-w-0 truncate pl-1 text-[13px] lg:pl-0">
        {server.node}
        {server.nodeLocation ? <span className="ml-1.5 text-muted-foreground">({server.nodeLocation})</span> : null}
      </p>
      <p className="min-w-0 truncate pl-1 font-mono text-[12.5px] text-muted-foreground lg:pl-0">{server.allocation}</p>

      <div className="grid grid-cols-3 gap-4 pl-1 lg:contents">
        <Meter label="CPU" value={live ? `${Math.round(server.cpu.used)}%` : "Off"} pct={live ? cpuPct : 0} />
        <Meter label="Memory" value={live ? formatCompact(server.memory.usedMb) : "Off"} pct={live ? ramPct : 0} />
        <Meter label="Disk" value={formatCompact(server.disk.usedMb)} pct={diskPct} />
      </div>

      <p className={cn("hidden items-center gap-2 text-[13px] font-medium lg:flex", meta.className)}>
        {meta.label}
      </p>
      {/* Small screens: status word next to the name instead of its own column. */}
      <p className={cn("absolute right-4 top-3.5 text-[13px] font-medium lg:hidden", meta.className)}>{meta.label}</p>
    </Link>
  );
}

/** A usage figure with a thin meter underneath. The meter warns at 80% and 90%. */
function Meter({ label, value, pct }: { label: string; value: string; pct: number }) {
  const tone = pct >= 90 ? "bg-status-error" : pct >= 80 ? "bg-status-warn" : "bg-foreground/45";
  return (
    <div className="min-w-0">
      <p className="flex items-baseline justify-between gap-2 text-[13px] tabular-nums">
        <span className="text-muted-foreground lg:sr-only">{label}</span>
        <span>{value}</span>
      </p>
      <span className="mt-1.5 block h-[3px] bg-border" aria-hidden>
        <span className={cn("block h-full", tone)} style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}
