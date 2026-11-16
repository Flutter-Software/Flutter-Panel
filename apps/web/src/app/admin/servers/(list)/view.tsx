"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { AdminPage } from "@/components/admin-table";
import { AdminServersPageSkeleton } from "@/components/skeletons";
import { QueryErrorPage } from "@/components/error-page";
import { confirm } from "@/components/confirm-dialog";
import { Button, ButtonLink, EmptyState, Input, Rack, RowField, Select } from "@/components/ui";
import { LedRail, statusMeta } from "@/components/status";
import { serverAlerts, serverAttention } from "@/components/server-card";
import { CpuLimit, LimitMb } from "@/components/unlimited";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { prefetchQuery, useQuery } from "@/lib/query";
import { useLiveReload } from "@/components/panel-socket";
import { formatCompact, type ServerRecord, type ServerStatus } from "@/lib/types";

const STATUS_FILTERS: ServerStatus[] = [
  "running",
  "starting",
  "stopping",
  "offline",
  "installing",
  "install_failed",
];

export default function AdminServersPage({ skeletonCount }: { skeletonCount?: number }) {
  const { data, error, errorStatus, reload } = useQuery<{ data: { servers: ServerRecord[] } }>(
    "/api/v1/admin/servers",
  );
  const servers = data?.data.servers ?? [];
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [node, setNode] = useState("");
  const [egg, setEgg] = useState("");
  const [owner, setOwner] = useState("");
  useLiveReload(reload, 3000);

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

  if (!data) {
    return <AdminServersPageSkeleton count={skeletonCount} />;
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
      {servers.length === 0 ? (
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
            <div>
              {/* Column legend for wide screens; rows wrap into labelled lines below xl. */}
              <div
                aria-hidden
                className="hidden px-4 py-2 text-[12px] text-muted-foreground xl:grid xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.8fr)_minmax(0,1.3fr)_auto] xl:gap-5"
              >
                <span className="pl-1">Server</span>
                <span>Node</span>
                <span>Address</span>
                <span>Owner</span>
                <span>Usage and limits</span>
                <span className="w-[9.5rem]" />
              </div>
              <Rack label="Servers">
                {filtered.map((server) => {
                  const meta = statusMeta(server.status);
                  const alerts = serverAlerts(server);
                  return (
                    <div
                      key={server.id}
                      role="listitem"
                      className="relative grid gap-3 px-4 py-3.5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.8fr)_minmax(0,1.3fr)_auto] xl:items-center xl:gap-5"
                    >
                      <LedRail status={server.status} />
                      <div className="min-w-0 pl-1">
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
                          <Link
                            href={`/admin/servers/${server.id}`}
                            onMouseEnter={() => prefetchQuery(`/api/v1/admin/servers/${server.id}`)}
                            className="truncate font-display text-[18px] font-semibold leading-tight hover:text-primary"
                          >
                            {server.name}
                          </Link>
                          <span className={cn("text-[13px] font-medium", meta.className)}>{meta.label}</span>
                        </div>
                        <p className="truncate text-[13px] text-muted-foreground">
                          {server.egg}
                          {server.description ? <span className="text-foreground/60">, {server.description}</span> : null}
                        </p>
                        {alerts.length ? (
                          <ul className="mt-1 flex flex-wrap gap-x-3">
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

                      <RowField label="Node">
                        {server.node}
                        {server.nodeLocation ? <span className="ml-1.5 text-muted-foreground">({server.nodeLocation})</span> : null}
                      </RowField>
                      <RowField label="Address">
                        <span className="font-mono text-[12.5px]">{server.allocation}</span>
                      </RowField>
                      <RowField label="Owner">{server.ownerName ?? <span className="text-muted-foreground">Nobody</span>}</RowField>
                      <RowField label="Usage and limits">
                        <span className="block tabular-nums">
                          CPU {Math.round(server.cpu.used)}% <span className="text-muted-foreground">of</span>{" "}
                          <CpuLimit value={server.cpu.limit} />
                        </span>
                        <span className="block text-[13px] tabular-nums text-muted-foreground">
                          {formatCompact(server.memory.usedMb)} of <LimitMb value={server.memory.limitMb} /> RAM,{" "}
                          {formatCompact(server.disk.usedMb)} of <LimitMb value={server.disk.limitMb} /> disk
                        </span>
                      </RowField>

                      <div className="flex items-center gap-1.5 pl-1 xl:w-[9.5rem] xl:justify-end xl:pl-0">
                        <ButtonLink
                          href={`/server/${server.id}`}
                          variant="ghost"
                          size="sm"
                          className="px-2"
                          aria-label={`Open ${server.name}`}
                        >
                          <ExternalLink className="size-4" />
                        </ButtonLink>
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
                  );
                })}
              </Rack>
            </div>
          )}
        </div>
      )}
    </AdminPage>
  );
}


