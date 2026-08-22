"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Box,
  Cpu,
  MapPin,
  Plus,
  Server,
  Settings,
  Upload,
  Users,
} from "lucide-react";
import { AdminError, AdminPage, ListSkeleton } from "@/components/admin-table";
import { statusMeta } from "@/components/status";
import { ButtonLink, Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { prefetchQuery, useQuery } from "@/lib/query";
import type { ServerRecord, ServerStatus } from "@/lib/types";
import type { PublicUser } from "@flutter-software/shared";
import type { LocationRecord } from "./locations/location-form";
import type { NestRecord } from "./nests/nest-form";

type HealthCheck = { ok: boolean; latencyMs?: number };
type Health = {
  ok: boolean;
  version?: string;
  checks: Record<string, HealthCheck>;
};

type NodeRow = {
  id: string;
  name: string;
  fqdn: string;
  location: string;
  online: boolean;
  maintenanceMode?: boolean;
  serverCount?: number;
};

type UpdateStatus = {
  version: string;
  updateAvailable: boolean;
  latest: { message: string; shortSha: string };
};

const STATUS_PILL: Record<ServerStatus, string> = {
  running: "bg-status-running/15 text-status-running",
  starting: "bg-status-warn/15 text-status-warn",
  stopping: "bg-status-warn/15 text-status-warn",
  installing: "bg-status-info/15 text-status-info",
  install_failed: "bg-status-error/15 text-status-error",
  offline: "bg-muted text-status-offline",
};

const HEALTH_LABELS: Record<string, string> = {
  mongo: "MongoDB",
  prisma: "Prisma",
  redis: "Redis",
};

export default function AdminDashboardPage() {
  const users = useQuery<{ data: { users: PublicUser[] } }>("/api/v1/admin/users");
  const locations = useQuery<{ data: { locations: LocationRecord[] } }>("/api/v1/admin/locations");
  const nodes = useQuery<{ data: { nodes: NodeRow[] } }>("/api/v1/admin/nodes");
  const servers = useQuery<{ data: { servers: ServerRecord[] } }>("/api/v1/admin/servers");
  const nests = useQuery<{ data: { nests: NestRecord[] } }>("/api/v1/admin/nests");
  const updates = useQuery<{ data: UpdateStatus }>("/api/v1/admin/settings/update");
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const serverRows = servers.data?.data.servers ?? [];
  const nodeRows = nodes.data?.data.nodes ?? [];
  const nestRows = nests.data?.data.nests ?? [];
  const locationRows = locations.data?.data.locations ?? [];
  const userRows = users.data?.data.users ?? [];

  useEffect(() => {
    const timer = window.setInterval(() => {
      void servers.reload();
      void nodes.reload();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [servers.reload, nodes.reload]);

  useEffect(() => {
    let cancelled = false;
    async function loadHealth() {
      try {
        const response = await fetch("/api/v1/health", { credentials: "include" });
        const json = (await response.json()) as Health;
        if (!cancelled) {
          setHealth(json);
          setHealthError(null);
        }
      } catch {
        if (!cancelled) setHealthError("Unreachable");
      }
    }
    void loadHealth();
    const timer = window.setInterval(() => void loadHealth(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const running = serverRows.filter((row) => row.status === "running").length;
  const installFailed = serverRows.filter((row) => row.status === "install_failed");
  const onlineNodes = nodeRows.filter((row) => row.online).length;
  const maintenanceNodes = nodeRows.filter((row) => row.maintenanceMode);
  const offlineNodes = nodeRows.filter((row) => !row.online);
  const eggCount = nestRows.reduce((sum, nest) => sum + (nest.eggCount ?? nest.eggs?.length ?? 0), 0);
  const adminCount = userRows.filter((row) => row.role === "admin").length;
  const loadError = servers.error ?? nodes.error ?? locations.error ?? users.error ?? nests.error;
  const loading =
    (!servers.data && !servers.error) ||
    (!nodes.data && !nodes.error) ||
    (!locations.data && !locations.error) ||
    (!users.data && !users.error) ||
    (!nests.data && !nests.error);

  const alerts = [
    ...offlineNodes.map((node) => ({
      href: `/admin/nodes/${node.id}`,
      label: `${node.name} is offline`,
      tone: "text-status-offline",
    })),
    ...maintenanceNodes.map((node) => ({
      href: `/admin/nodes/${node.id}/settings`,
      label: `${node.name} is in maintenance`,
      tone: "text-status-warn",
    })),
    ...installFailed.map((server) => ({
      href: `/admin/servers/${server.id}`,
      label: `${server.name} failed to install`,
      tone: "text-status-error",
    })),
    ...serverRows
      .filter((row) => row.status === "installing")
      .map((server) => ({
        href: `/admin/servers/${server.id}`,
        label: `${server.name} is installing`,
        tone: "text-status-info",
      })),
  ];

  const stats = [
    {
      label: "Servers",
      value: serverRows.length,
      href: "/admin/servers",
      icon: Server,
      hint: serverRows.length ? `${running} running` : "Create a server",
    },
    {
      label: "Nodes",
      value: nodeRows.length,
      href: "/admin/nodes",
      icon: Cpu,
      hint: nodeRows.length ? `${onlineNodes} online` : "Add a machine",
    },
    {
      label: "Locations",
      value: locationRows.length,
      href: "/admin/locations",
      icon: MapPin,
      hint: locationRows.length
        ? `${locationRows.reduce((sum, row) => sum + (row.nodeCount ?? 0), 0)} nodes`
        : "Group your nodes",
    },
    {
      label: "Nests",
      value: nestRows.length,
      href: "/admin/nests",
      icon: Box,
      hint: nestRows.length ? `${eggCount} egg${eggCount === 1 ? "" : "s"}` : "Import or create eggs",
    },
    {
      label: "Users",
      value: userRows.length,
      href: "/admin/users",
      icon: Users,
      hint: userRows.length ? `${adminCount} admin${adminCount === 1 ? "" : "s"}` : "Invite an account",
    },
  ];

  return (
    <AdminPage
      title="Dashboard"
      description="Fleet, nodes, eggs, and accounts on this panel."
      actions={
        <ButtonLink href="/admin/servers/new">
          <Plus className="size-4" />
          New server
        </ButtonLink>
      }
    >
      <AdminError message={loadError} />
      {loading ? <ListSkeleton rows={3} /> : null}

      {!loading ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {stats.map((stat) => {
              const Icon = stat.icon;
              return (
                <Link key={stat.label} href={stat.href}>
                  <Card className="p-4 transition-colors hover:border-primary/40">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {stat.label}
                        </p>
                        <p className="mt-2 text-2xl font-semibold tabular-nums">{stat.value}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{stat.hint}</p>
                      </div>
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Icon className="size-4" />
                      </span>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/admin/nodes/new" variant="secondary" size="sm">
              <Plus className="size-3.5" />
              New node
            </ButtonLink>
            <ButtonLink href="/admin/nests/eggs/import" variant="secondary" size="sm">
              <Upload className="size-3.5" />
              Import egg
            </ButtonLink>
            <ButtonLink href="/admin/users/new" variant="secondary" size="sm">
              <Plus className="size-3.5" />
              New user
            </ButtonLink>
            <ButtonLink href="/admin/settings" variant="secondary" size="sm">
              <Settings className="size-3.5" />
              Settings
            </ButtonLink>
          </div>

          {updates.data?.data.updateAvailable ? (
            <Link href="/admin/settings">
              <Card className="p-4 transition-colors hover:border-primary/40">
                <p className="text-sm font-semibold">Panel update available</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {updates.data.data.latest.message || "A newer build is on GitHub."} Open Settings to review
                  and apply it.
                </p>
              </Card>
            </Link>
          ) : null}

          {alerts.length ? (
            <Card className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Needs attention
              </p>
              <ul className="mt-3 space-y-2">
                {alerts.slice(0, 8).map((alert) => (
                  <li key={`${alert.href}-${alert.label}`}>
                    <Link href={alert.href} className={cn("text-sm hover:underline", alert.tone)}>
                      {alert.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="overflow-hidden lg:col-span-2">
              <SectionHead title="Servers" href="/admin/servers" count={serverRows.length} />
              {serverRows.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Create a node and allocations first, then place a game server.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {serverRows.slice(0, 8).map((server) => {
                    const meta = statusMeta(server.status);
                    return (
                      <li key={server.id}>
                        <Link
                          href={`/admin/servers/${server.id}`}
                          onMouseEnter={() => prefetchQuery(`/api/v1/admin/servers/${server.id}`)}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted/40"
                        >
                          <span className="min-w-0 flex-1 font-medium">{server.name}</span>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                              STATUS_PILL[server.status],
                            )}
                          >
                            <span className={cn("size-1.5 rounded-full", meta.bar)} />
                            {meta.label}
                          </span>
                          <span className="w-full text-xs text-muted-foreground sm:w-auto">
                            {server.egg}
                            {server.node ? ` · ${server.node}` : ""}
                            {server.allocation ? ` · ${server.allocation}` : ""}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              {serverRows.length > 8 ? (
                <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
                  Showing 8 of {serverRows.length}.{" "}
                  <Link href="/admin/servers" className="text-foreground hover:underline">
                    View all
                  </Link>
                </p>
              ) : null}
            </Card>

            <div className="space-y-4">
              <Card className="overflow-hidden">
                <SectionHead title="Nodes" href="/admin/nodes" count={nodeRows.length} />
                {nodeRows.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Create a location first, then add a machine to run the daemon.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {nodeRows.slice(0, 6).map((node) => (
                      <li key={node.id}>
                        <Link
                          href={`/admin/nodes/${node.id}`}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{node.name}</span>
                            <span className="block truncate font-mono text-[11px] text-muted-foreground">
                              {node.fqdn}
                              {node.location ? ` · ${node.location}` : ""}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
                              node.maintenanceMode
                                ? "bg-status-warn/15 text-status-warn"
                                : node.online
                                  ? "bg-status-running/15 text-status-running"
                                  : "bg-status-offline/15 text-status-offline",
                            )}
                          >
                            {node.maintenanceMode ? "Maintenance" : node.online ? "Online" : "Offline"}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card className="p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Services
                </p>
                {healthError ? (
                  <p className="mt-3 text-sm text-destructive">{healthError}</p>
                ) : !health ? (
                  <p className="mt-3 text-sm text-muted-foreground">Checking…</p>
                ) : (
                  <ul className="mt-3 space-y-2.5">
                    {Object.entries(health.checks).map(([name, check]) => (
                      <li key={name} className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              "size-1.5 rounded-full",
                              check.ok ? "bg-status-running" : "bg-status-error",
                            )}
                          />
                          {HEALTH_LABELS[name] ?? name}
                        </span>
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {check.ok
                            ? check.latencyMs != null
                              ? `${check.latencyMs} ms`
                              : "Up"
                            : "Down"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </>
      ) : null}
    </AdminPage>
  );
}

function SectionHead({ title, href, count }: { title: string; href: string; count: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <p className="text-sm font-semibold">
        {title}
        <span className="ml-2 text-xs font-normal text-muted-foreground">{count}</span>
      </p>
      <Link href={href} className="text-xs text-muted-foreground hover:text-foreground">
        View all
      </Link>
    </div>
  );
}
