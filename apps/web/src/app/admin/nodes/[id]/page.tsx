"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { AdminError, ListSkeleton } from "@/components/admin-table";
import { ButtonLink, Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useQuery } from "@/lib/query";
import { formatMb } from "@/lib/types";

type Allocation = { id: string; ip: string; port: number; assigned: boolean };
type Node = {
  id: string;
  name: string;
  fqdn: string;
  memoryMb: number;
  diskMb: number;
  online: boolean;
  location: string;
  allocations: Allocation[];
};

export default function NodeDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, error } = useQuery<{ data: { nodes: Node[] } }>("/api/v1/admin/nodes");
  const node = data?.data.nodes.find((row) => row.id === params.id) ?? null;

  const allocations = node?.allocations ?? [];
  const usedCount = allocations.filter((row) => row.assigned).length;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <Link
          href="/admin/nodes"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Nodes
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{node?.name ?? "Node"}</h1>
        <p className="mt-1 font-mono text-sm text-muted-foreground">
          {node?.fqdn ?? "\u00a0"}
        </p>
      </div>

      <AdminError message={error} />

      {node ? (
        <>
          <Card className="p-5 sm:p-6">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <Meta label="Location" value={node.location || "—"} />
              <Meta
                label="Status"
                value={node.online ? "Online" : "Offline"}
                valueClassName={node.online ? "text-status-running" : "text-status-offline"}
              />
              <Meta label="Memory" value={formatMb(node.memoryMb)} />
              <Meta label="Disk" value={formatMb(node.diskMb)} />
            </div>
            <div className="mt-5 border-t border-border pt-5">
              <Meta label="Allocations" value={`${usedCount} used / ${allocations.length} total`} />
            </div>
          </Card>

          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Allocations</h2>
            <ButtonLink href={`/admin/nodes/${node.id}/allocations/new`} size="sm">
              <Plus className="size-3.5" />
              Add allocations
            </ButtonLink>
          </div>

          {allocations.length ? (
            <div className="flex flex-wrap gap-2">
              {allocations.map((row) => (
                <span
                  key={row.id}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-xs",
                    row.assigned
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  {row.ip}:{row.port}
                  {row.assigned ? (
                    <span className="font-sans text-[10px] font-semibold uppercase tracking-wide">
                      used
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
          ) : (
            <Card className="px-4 py-10 text-center text-sm text-muted-foreground">
              No allocations yet. Add an IP and port range to place servers on this node.
            </Card>
          )}
        </>
      ) : data && !error ? (
        <AdminError message="Node not found" />
      ) : !error ? (
        <ListSkeleton rows={2} />
      ) : null}
    </div>
  );
}

function Meta({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-1 text-sm font-medium", valueClassName)}>{value}</p>
    </div>
  );
}
