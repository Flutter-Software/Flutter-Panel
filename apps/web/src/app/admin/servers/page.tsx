"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ExternalLink, Pencil, Plus, Server, Trash2 } from "lucide-react";
import { AdminError, AdminPage, ListSkeleton } from "@/components/admin-table";
import { Button, ButtonLink, Card } from "@/components/ui";
import { statusMeta } from "@/components/status";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { prefetchQuery, useQuery } from "@/lib/query";
import { formatCpuLimit, formatLimitMb, type ServerRecord, type ServerStatus } from "@/lib/types";

const STATUS_PILL: Record<ServerStatus, string> = {
  running: "bg-status-running/15 text-status-running",
  starting: "bg-status-warn/15 text-status-warn",
  stopping: "bg-status-warn/15 text-status-warn",
  installing: "bg-status-info/15 text-status-info",
  install_failed: "bg-status-error/15 text-status-error",
  offline: "bg-muted text-status-offline",
};

export default function AdminServersPage() {
  const { data, error, reload } = useQuery<{ data: { servers: ServerRecord[] } }>(
    "/api/v1/admin/servers",
  );
  const servers = data?.data.servers ?? [];

  useEffect(() => {
    const timer = window.setInterval(() => {
      void reload();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [reload]);

  async function onDelete(server: ServerRecord) {
    if (!window.confirm(`Delete server ${server.name}? The container will be destroyed.`)) return;
    try {
      await api(`/api/v1/admin/servers/${server.id}`, { method: "DELETE" });
      await reload();
    } catch {
      await reload();
    }
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
      <AdminError message={error} />
      {!data && !error ? (
        <ListSkeleton />
      ) : servers.length === 0 ? (
        <Card className="px-6 py-16 text-center">
          <p className="text-base font-semibold">No servers yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a node and allocations first, then place a game server.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {servers.map((server) => {
            const meta = statusMeta(server.status);
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

                <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <Meta label="Node" value={nodeLabel} />
                  <Meta label="Address" value={server.allocation} mono />
                  <Meta label="Owner" value={server.ownerName ?? "—"} />
                  <Meta
                    label="Limits"
                    value={`${formatLimitMb(server.memory.limitMb)} · ${formatLimitMb(server.disk.limitMb)} · ${formatCpuLimit(server.cpu.limit)} CPU`}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </AdminPage>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-1 truncate", mono && "font-mono text-xs")}>{value}</p>
    </div>
  );
}
