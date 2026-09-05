"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Pencil, Plus, Search, Server, Trash2, X } from "lucide-react";
import { AdminPage, ListSkeleton } from "@/components/admin-table";
import { QueryErrorPage } from "@/components/error-page";
import { confirm } from "@/components/confirm-dialog";
import { Button, ButtonLink, Card, EmptyState, Input, Select } from "@/components/ui";
import { statusMeta } from "@/components/status";
import { serverAlerts, serverAttention } from "@/components/server-card";
import { CpuLimit, LimitMb } from "@/components/unlimited";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { prefetchQuery, useQuery } from "@/lib/query";
import { formatCompact, type ServerRecord, type ServerStatus } from "@/lib/types";

const STATUS_PILL: Record<ServerStatus, string> = {
  running: "bg-status-running/15 text-status-running",
  starting: "bg-status-warn/15 text-status-warn",
  stopping: "bg-status-warn/15 text-status-warn",
  installing: "bg-status-info/15 text-status-info",
  install_failed: "bg-status-error/15 text-status-error",
  offline: "bg-muted text-status-offline",
};

const STATUS_FILTERS: ServerStatus[] = [
  "running",
  "starting",
  "stopping",
  "offline",
  "installing",
  "install_failed",
];

export default function AdminServersPage() {
  const { data, error, errorStatus, reload } = useQuery<{ data: { servers: ServerRecord[] } }>(
    "/api/v1/admin/servers",
  );
  const servers = data?.data.servers ?? [];
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [node, setNode] = useState("");
  const [egg, setEgg] = useState("");
  const [owner, setOwner] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => {
      void reload();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const nodes = useMemo(
    () => [...new Set(servers.map((server) => server.node).filter(Boolean))].sort(),
    [servers],
  );
  const eggs = useMemo(
    () => [...new Set(servers.map((server) => server.egg).filter(Boolean))].sort(),
    [servers],
  );
  const owners = useMemo(
    () =>
      [...new Set(servers.map((server) => server.ownerName).filter((name): name is string => Boolean(name)))].sort(),
    [servers],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return servers.filter((server) => {
      if (status && server.status !== status) return false;
      if (node && server.node !== node) return false;
      if (egg && server.egg !== egg) return false;
      if (owner && (server.ownerName ?? "") !== owner) return false;
      if (!needle) return true;
      const haystack = [
        server.name,
        server.egg,
        server.node,
        server.nodeLocation,
        server.allocation,
        server.ownerName,
        server.description,
        server.uuid,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    }).sort((a, b) => serverAttention(b) - serverAttention(a) || a.name.localeCompare(b.name));
  }, [servers, query, status, node, egg, owner]);

  const filtering = Boolean(query.trim() || status || node || egg || owner);

  function clearFilters() {
    setQuery("");
    setStatus("");
    setNode("");
    setEgg("");
    setOwner("");
  }

  async function onDelete(server: ServerRecord) {
    if (
      !(await confirm({
        title: "Delete server",
        description: `Delete ${server.name}? The container will be destroyed.`,
        confirmLabel: "Delete",
      }))
    ) {
      return;
    }
    try {
      await api(`/api/v1/admin/servers/${server.id}`, { method: "DELETE" });
      await reload();
    } catch {
      await reload();
    }
  }

  if (error && !data) {
    return (
      <QueryErrorPage
        error={error}
        status={errorStatus}
        onRetry={() => void reload()}
        homeHref="/admin"
        homeLabel="Back to admin"
      />
    );
  }

  return (
    <AdminPage
      title="Servers"
      actions={
        <ButtonLink href="/admin/servers/new">
          <Plus className="size-4" />
          New server
        </ButtonLink>
      }
    >
      {!data ? (
        <ListSkeleton />
      ) : servers.length === 0 ? (
        <EmptyState
          title="No servers yet"
          description="Create a node and allocations first, then place a game server."
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search servers"
                className="h-8 pl-8 text-sm"
                aria-label="Search servers"
              />
            </div>
            <Select
              compact
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="w-[9.75rem]"
            >
              <option value="">Status</option>
              {STATUS_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {statusMeta(value).label}
                </option>
              ))}
            </Select>
            <Select
              compact
              value={node}
              onChange={(event) => setNode(event.target.value)}
              className="w-[9.75rem]"
            >
              <option value="">Node</option>
              {nodes.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
            <Select
              compact
              value={egg}
              onChange={(event) => setEgg(event.target.value)}
              className="w-[9.75rem]"
            >
              <option value="">Egg</option>
              {eggs.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
            <Select
              compact
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              className="w-[9.75rem]"
            >
              <option value="">Owner</option>
              {owners.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
            {filtering ? (
              <>
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={clearFilters}>
                  <X className="size-3.5" />
                  Clear
                </Button>
                <p className="ml-auto text-xs text-muted-foreground">
                  {filtered.length} of {servers.length}
                </p>
              </>
            ) : null}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="No servers match"
              description="Try a different search or clear the filters."
            />
          ) : (
            filtered.map((server) => {
              const meta = statusMeta(server.status);
              const alerts = serverAlerts(server);
              const nodeLabel = server.nodeLocation
                ? `${server.node} · ${server.nodeLocation}`
                : server.node;
              return (
                <Card key={server.id} className="p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/admin/servers/${server.id}`}
                          onMouseEnter={() => prefetchQuery(`/api/v1/admin/servers/${server.id}`)}
                          className="flex min-w-0 items-center gap-2 hover:underline"
                        >
                          <Server className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate text-base font-semibold">{server.name}</span>
                        </Link>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                            STATUS_PILL[server.status],
                          )}
                        >
                          <span className={cn("size-1.5 rounded-full", meta.bar)} />
                          {meta.label}
                        </span>
                        <ButtonLink
                          href={`/server/${server.id}`}
                          variant="secondary"
                          size="sm"
                          className="h-7 px-2"
                        >
                          <ExternalLink className="size-3.5" />
                          Open
                        </ButtonLink>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{server.egg}</p>
                      {server.description ? (
                        <p className="mt-1 text-sm text-muted-foreground">{server.description}</p>
                      ) : null}
                      {alerts.length ? (
                        <ul className="mt-2 space-y-0.5">
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
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <ButtonLink href={`/admin/servers/${server.id}`} variant="secondary" size="sm">
                        <Pencil className="size-3.5" />
                        Edit
                      </ButtonLink>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="size-8 px-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${server.name}`}
                        onClick={() => onDelete(server)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
                    <Meta label="Node" value={nodeLabel} />
                    <Meta label="Address" value={server.allocation} mono />
                    <Meta label="Owner" value={server.ownerName ?? "—"} />
                    <Meta
                      label="Usage"
                      value={`CPU ${Math.round(server.cpu.used)}% · ${formatCompact(server.memory.usedMb)} · ${formatCompact(server.disk.usedMb)} disk`}
                    />
                    <Meta
                      label="Limits"
                      value={
                        <span className="inline-flex items-center gap-1">
                          <LimitMb value={server.memory.limitMb} />
                          <span className="text-muted-foreground">·</span>
                          <LimitMb value={server.disk.limitMb} />
                          <span className="text-muted-foreground">·</span>
                          <span className="inline-flex items-center gap-0.5">
                            <CpuLimit value={server.cpu.limit} /> CPU
                          </span>
                        </span>
                      }
                    />
                  </div>
                </Card>
              );
            })
          )}
        </div>
      )}
    </AdminPage>
  );
}

function Meta({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate", mono && "font-mono text-xs")}>{value}</p>
    </div>
  );
}
