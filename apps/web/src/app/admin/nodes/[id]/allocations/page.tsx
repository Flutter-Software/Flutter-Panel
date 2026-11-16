"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { AdminError } from "@/components/admin-table";
import { useAdminNode } from "@/components/node-frame";
import { confirm } from "@/components/confirm-dialog";
import { Button, ButtonLink, EmptyState, Rack } from "@/components/ui";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";

const COLUMNS = "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]";

export default function NodeAllocationsPage() {
  const { node, reload } = useAdminNode();
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  if (!node) return null;

  const nodeId = node.id;
  const used = node.allocations.filter((row) => row.assigned).length;

  async function onRemove(id: string, label: string) {
    if (
      !(await confirm({
        title: "Remove allocation",
        description: `Remove ${label} from this node? Servers will no longer be able to use it.`,
        confirmLabel: "Remove",
      }))
    ) {
      return;
    }
    setError(null);
    setRemovingId(id);
    try {
      await api(`/api/v1/admin/nodes/${nodeId}/allocations/${id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove the allocation. Refresh the page; a server may have claimed it.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          <span className="tabular-nums text-foreground">{used}</span> in use,{" "}
          <span className="tabular-nums text-foreground">{node.allocations.length - used}</span> free
        </p>
        <ButtonLink href={`/admin/nodes/${node.id}/allocations/new`} size="sm">
          <Plus className="size-3.5" />
          Add allocations
        </ButtonLink>
      </div>
      <AdminError message={error} />
      {node.allocations.length ? (
        <div>
          {/* Column legend for wide screens; rows wrap into labelled lines below md. */}
          <div aria-hidden className={cn("hidden px-4 py-2 text-[12px] text-muted-foreground md:grid md:gap-5", COLUMNS)}>
            <span>Address</span>
            <span>Alias</span>
            <span>Server</span>
            <span className="w-[7.5rem]" />
          </div>
          <Rack label="Allocations">
            {node.allocations.map((row) => (
              <div
                key={row.id}
                role="listitem"
                className={cn("relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm md:gap-x-5", COLUMNS)}
              >
                <span className="min-w-0 truncate font-mono text-[13px]">
                  {row.ip}:{row.port}
                </span>
                <span className="row-span-3 flex items-center justify-end gap-2 md:order-last md:row-span-1 md:w-[7.5rem]">
                  <span
                    className={cn(
                      "text-[13px] font-medium",
                      row.assigned ? "text-foreground" : "text-status-running",
                    )}
                  >
                    {row.assigned ? "In use" : "Free"}
                  </span>
                  {row.assigned ? (
                    <span className="size-8" aria-hidden />
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="size-8 px-0 text-muted-foreground hover:text-destructive"
                      disabled={removingId === row.id}
                      aria-label={`Remove ${row.ip}:${row.port}`}
                      onClick={() => void onRemove(row.id, `${row.ip}:${row.port}`)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </span>
                <span className={cn("min-w-0 truncate text-[13px] text-muted-foreground", !row.alias && "hidden md:block")}>
                  {row.alias ? <span className="font-mono text-[12.5px]">{row.alias}</span> : "No alias"}
                </span>
                <span className="min-w-0 truncate">
                  {row.serverId ? (
                    <Link href={`/admin/servers/${row.serverId}`} className="text-primary hover:underline">
                      {row.serverName || row.serverId}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Not assigned</span>
                  )}
                </span>
              </div>
            ))}
          </Rack>
        </div>
      ) : (
        <EmptyState
          title="No allocations yet"
          description="Add an IP and a port range so servers on this node have somewhere to listen."
        />
      )}
    </div>
  );
}
