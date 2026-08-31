"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Plus, Server, Trash2 } from "lucide-react";
import { AdminError, AdminPage, ListSkeleton } from "@/components/admin-table";
import { QueryErrorPage } from "@/components/error-page";
import { confirm } from "@/components/confirm-dialog";
import { Button, ButtonLink, Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { prefetchQuery, useQuery } from "@/lib/query";
import { formatGiB } from "@/lib/types";

type Allocation = { id: string; ip: string; port: number; assigned: boolean };

const ALLOCATION_PREVIEW = 6;

function AllocationChip({ row }: { row: Allocation }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs",
        row.assigned
          ? "border-primary/40 text-primary"
          : "border-border text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          row.assigned ? "bg-primary" : "bg-status-running",
        )}
      />
      {row.ip}:{row.port}
      {row.assigned ? null : <span className="font-sans text-[10px]">free</span>}
    </span>
  );
}

function NodeAllocationChips({ allocations }: { allocations: Allocation[] }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...allocations].sort((a, b) => Number(b.assigned) - Number(a.assigned));
  const extra = Math.max(0, sorted.length - ALLOCATION_PREVIEW);
  const visible = extra && !expanded ? sorted.slice(0, ALLOCATION_PREVIEW) : sorted;

  if (!allocations.length) {
    return <p className="mt-2 text-sm text-muted-foreground">No allocations yet.</p>;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {visible.map((row) => (
        <AllocationChip key={row.id} row={row} />
      ))}
      {extra ? (
        <button
          type="button"
          className="inline-flex items-center rounded-md border border-dashed border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "Show less" : `${extra} more...`}
        </button>
      ) : null}
    </div>
  );
}

type Node = {
  id: string;
  name: string;
  fqdn: string;
  description: string;
  location: string;
  memoryMb: number;
  memoryCommittedMb: number;
  tokenPrefix: string | null;
  online: boolean;
  allocations: Allocation[];
};

export default function AdminNodesPage() {
  const { data, error, errorStatus, reload } = useQuery<{ data: { nodes: Node[] } }>("/api/v1/admin/nodes");
  const nodes = data?.data.nodes ?? [];
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      void reload();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [reload]);

  async function copyToken(node: Node) {
    try {
      const result = await api<{ data: { token: string; preview: string } }>(
        `/api/v1/admin/nodes/${node.id}/token`,
        { method: "POST" },
      );
      await navigator.clipboard.writeText(result.data.token);
      setCopiedId(node.id);
      window.setTimeout(() => setCopiedId(null), 1500);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Copy failed");
    }
  }

  async function onDelete(node: Node) {
    if (
      !(await confirm({
        title: "Delete node",
        description: `Delete ${node.name}? This cannot be undone.`,
        confirmLabel: "Delete",
      }))
    ) {
      return;
    }
    setActionError(null);
    try {
      await api(`/api/v1/admin/nodes/${node.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed");
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
      title="Nodes"
      actions={
        <ButtonLink href="/admin/nodes/new">
          <Plus className="size-4" />
          New node
        </ButtonLink>
      }
    >
      <AdminError message={actionError} />
      {!data ? (
        <ListSkeleton />
      ) : nodes.length === 0 ? (
        <Card className="px-6 py-16 text-center">
          <p className="text-base font-semibold">No nodes yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a location first, then add a machine to run the daemon.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {nodes.map((node) => {
            const pct =
              node.memoryMb > 0
                ? Math.min(100, (node.memoryCommittedMb / node.memoryMb) * 100)
                : 0;
            return (
              <Card key={node.id} className="p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <Link
                    href={`/admin/nodes/${node.id}`}
                    onMouseEnter={() => prefetchQuery("/api/v1/admin/nodes")}
                    className="min-w-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Server className="size-4 text-muted-foreground" />
                      <span className="text-base font-semibold">{node.name}</span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                          node.online
                            ? "bg-status-running/15 text-status-running"
                            : "bg-status-offline/15 text-status-offline",
                        )}
                      >
                        {node.online ? "Online" : "Offline"}
                      </span>
                      {node.location ? (
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {node.location}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{node.fqdn}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/80">{node.id}</p>
                    {node.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">{node.description}</p>
                    ) : null}
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <ButtonLink
                      href={`/admin/nodes/${node.id}/allocations`}
                      variant="secondary"
                      size="sm"
                    >
                      <Plus className="size-3.5" />
                      Allocation
                    </ButtonLink>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="size-8 px-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${node.name}`}
                      onClick={() => onDelete(node)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>

                <div className="mt-5 grid gap-5 sm:grid-cols-2 sm:items-end">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Memory allocated
                    </p>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="shrink-0 tabular-nums text-sm text-foreground/80">
                        {formatGiB(node.memoryCommittedMb)} / {formatGiB(node.memoryMb)}
                      </span>
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Daemon token
                    </p>
                    <div className="mt-2 flex items-center gap-1.5 font-mono text-sm">
                      <span className="truncate text-muted-foreground">
                        {node.tokenPrefix ? `${node.tokenPrefix}••••` : "flt_••••••••••••"}
                      </span>
                      <button
                        type="button"
                        className="inline-flex shrink-0 bg-transparent p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                        aria-label={copiedId === node.id ? "Copied" : "Copy daemon token"}
                        onClick={() => copyToken(node)}
                      >
                        {copiedId === node.id ? (
                          <Check className="size-3.5 text-status-running" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Allocations ({node.allocations.length})
                  </p>
                  <NodeAllocationChips allocations={node.allocations} />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </AdminPage>
  );
}
