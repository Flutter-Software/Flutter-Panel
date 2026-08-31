"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { AdminError } from "@/components/admin-table";
import { useAdminNode } from "@/components/node-frame";
import { confirm } from "@/components/confirm-dialog";
import { Button, ButtonLink, Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";

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
        description: `Remove ${label}?`,
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
      setError(err instanceof Error ? err.message : "Could not remove allocation");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {used} assigned / {node.allocations.length} total
        </p>
        <ButtonLink href={`/admin/nodes/${node.id}/allocations/new`} size="sm">
          <Plus className="size-3.5" />
          Add allocations
        </ButtonLink>
      </div>
      <AdminError message={error} />
      {node.allocations.length ? (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-x-4 border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Address</span>
            <span>Alias</span>
            <span>Server</span>
            <span className="text-right">Status</span>
          </div>
          <ul className="divide-y divide-border">
            {node.allocations.map((row) => (
              <li
                key={row.id}
                className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-x-4 px-4 py-2.5 text-sm"
              >
                <span className="font-mono text-xs">
                  {row.ip}:{row.port}
                </span>
                <span className="text-xs text-muted-foreground">{row.alias || "—"}</span>
                <span className="truncate">
                  {row.serverId ? (
                    <Link href={`/admin/servers/${row.serverId}`} className="text-primary hover:underline">
                      {row.serverName || row.serverId}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                </span>
                <span className="inline-flex items-center justify-end gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      row.assigned ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {row.assigned ? "In use" : "Free"}
                  </span>
                  {row.assigned ? null : (
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
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card className="px-4 py-10 text-center text-sm text-muted-foreground">
          No allocations yet. Add an IP and port range to place servers on this node.
        </Card>
      )}
    </div>
  );
}
