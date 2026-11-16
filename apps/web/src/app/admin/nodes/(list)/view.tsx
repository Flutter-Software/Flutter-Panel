"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { AdminError, AdminPage } from "@/components/admin-table";
import { AdminNodesPageSkeleton } from "@/components/skeletons";
import { QueryErrorPage } from "@/components/error-page";
import { confirm } from "@/components/confirm-dialog";
import { Button, ButtonLink, EmptyState, Rack, RowField } from "@/components/ui";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { prefetchQuery, useQuery } from "@/lib/query";
import { useLiveReload } from "@/components/panel-socket";
import { formatGiB } from "@/lib/types";

type Allocation = { id: string; ip: string; port: number; assigned: boolean };

const ALLOCATION_PREVIEW = 6;

/** Allocations as plain addresses: in-use ones in the foreground, free ones dimmed and marked. */
function NodeAllocations({ allocations }: { allocations: Allocation[] }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...allocations].sort((a, b) => Number(b.assigned) - Number(a.assigned));
  const extra = Math.max(0, sorted.length - ALLOCATION_PREVIEW);
  const visible = extra && !expanded ? sorted.slice(0, ALLOCATION_PREVIEW) : sorted;

  if (!allocations.length) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No allocations yet. Add an IP and port range before placing servers here.
      </p>
    );
  }

  return (
    <ul className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      {visible.map((row) => (
        <li key={row.id} className="text-[13px]">
          <span className={cn("font-mono text-[12.5px]", row.assigned ? "text-foreground" : "text-muted-foreground")}>
            {row.ip}:{row.port}
          </span>
          {row.assigned ? null : <span className="ml-1.5 text-[12px] text-status-running">free</span>}
        </li>
      ))}
      {extra ? (
        <li>
          <button
            type="button"
            className="rounded-sm text-[13px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? "Show fewer" : `Show ${extra} more`}
          </button>
        </li>
      ) : null}
    </ul>
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
  maintenanceMode?: boolean;
  allocations: Allocation[];
};

const COLUMNS = "xl:grid-cols-[minmax(0,1.5fr)_minmax(0,0.6fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_auto]";

/** Node state as rail colour, LED colour and word. Maintenance outranks online and offline. */
function nodeState(node: Node) {
  if (node.maintenanceMode) return { label: "Maintenance", text: "text-status-warn", bar: "bg-status-warn" };
  if (node.online) return { label: "Online", text: "text-status-running", bar: "bg-status-running" };
  return { label: "Offline", text: "text-status-error", bar: "bg-status-error" };
}

export default function AdminNodesPage({ skeletonCount }: { skeletonCount?: number }) {
  const { data, error, errorStatus, reload } = useQuery<{ data: { nodes: Node[] } }>("/api/v1/admin/nodes");
  const nodes = data?.data.nodes ?? [];
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  useLiveReload(reload, 15_000);

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
      setActionError(err instanceof Error ? err.message : "Couldn't copy the daemon token. Allow clipboard access for this site, then try again.");
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
      setActionError(err instanceof Error ? err.message : "Couldn't delete the node. Delete its servers first, then try again.");
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
    return <AdminNodesPageSkeleton count={skeletonCount} />;
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
      {nodes.length === 0 ? (
        <EmptyState
          title="No nodes yet"
          description="Create a location first, then add the machine that will run the daemon."
        />
      ) : (
        <div>
          {/* Column legend for wide screens; rows wrap into labelled lines below xl. */}
          <div aria-hidden className={cn("hidden px-4 py-2 text-[12px] text-muted-foreground xl:grid xl:gap-5", COLUMNS)}>
            <span className="pl-1">Node</span>
            <span>Location</span>
            <span>Memory allocated</span>
            <span>Daemon token</span>
            <span className="w-[10rem]" />
          </div>
          <Rack label="Nodes">
            {nodes.map((node) => {
              const pct =
                node.memoryMb > 0
                  ? Math.min(100, (node.memoryCommittedMb / node.memoryMb) * 100)
                  : 0;
              const state = nodeState(node);
              const free = node.allocations.filter((row) => !row.assigned).length;
              return (
                <div
                  key={node.id}
                  role="listitem"
                  className={cn("relative grid gap-3 px-4 py-3.5 xl:items-start xl:gap-5", COLUMNS)}
                >
                  <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", state.bar)} />
                  <div className="min-w-0 pl-1">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
                      <Link
                        href={`/admin/nodes/${node.id}`}
                        onMouseEnter={() => prefetchQuery("/api/v1/admin/nodes")}
                        className="truncate font-display text-[18px] font-semibold leading-tight hover:text-primary"
                      >
                        {node.name}
                      </Link>
                      <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-medium", state.text)}>
                        <span aria-hidden className={cn("size-2 rounded-full", state.bar)} />
                        {state.label}
                      </span>
                    </div>
                    <p className="truncate font-mono text-[12.5px] text-muted-foreground">{node.fqdn}</p>
                    {node.description ? (
                      <p className="truncate text-[13px] text-muted-foreground">{node.description}</p>
                    ) : null}
                  </div>

                  <RowField label="Location">
                    {node.location || <span className="text-muted-foreground">None</span>}
                  </RowField>

                  <RowField label="Memory allocated">
                    <span className="block tabular-nums">
                      {formatGiB(node.memoryCommittedMb)} <span className="text-muted-foreground">of</span>{" "}
                      {formatGiB(node.memoryMb)}
                    </span>
                    <span className="mt-1.5 block h-[3px] max-w-[12rem] bg-border" aria-hidden>
                      <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
                    </span>
                  </RowField>

                  <RowField label="Daemon token">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-mono text-[12.5px] text-muted-foreground">
                        {node.tokenPrefix ? `${node.tokenPrefix}••••` : "flt_••••••••••••"}
                      </span>
                      <button
                        type="button"
                        className="inline-flex shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        aria-label={copiedId === node.id ? "Copied" : `Copy daemon token for ${node.name}`}
                        title={copiedId === node.id ? "Copied" : "Copy token"}
                        onClick={() => copyToken(node)}
                      >
                        {copiedId === node.id ? (
                          <Check className="size-3.5 text-status-running" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                      </button>
                    </span>
                  </RowField>

                  <div className="flex items-center gap-1.5 pl-1 xl:w-[10rem] xl:justify-end xl:pl-0">
                    <ButtonLink href={`/admin/nodes/${node.id}/allocations`} variant="secondary" size="sm">
                      <Plus className="size-3.5" />
                      Allocations
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

                  <div className="min-w-0 pl-1 xl:col-span-full">
                    <p className="text-[12px] text-muted-foreground">
                      <span className="tabular-nums">{node.allocations.length}</span>{" "}
                      {node.allocations.length === 1 ? "allocation" : "allocations"}
                      {node.allocations.length ? (
                        <>
                          , <span className="tabular-nums">{free}</span> free
                        </>
                      ) : null}
                    </p>
                    <div className="mt-0.5">
                      <NodeAllocations allocations={node.allocations} />
                    </div>
                  </div>
                </div>
              );
            })}
          </Rack>
        </div>
      )}
    </AdminPage>
  );
}

