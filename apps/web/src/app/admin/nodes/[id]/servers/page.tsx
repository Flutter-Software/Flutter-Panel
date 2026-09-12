"use client";

import Link from "next/link";
import { useAdminNode } from "@/components/node-frame";
import { Card } from "@/components/ui";
import { statusMeta, statusPillClass } from "@/components/status";
import { LimitMb } from "@/components/unlimited";
import { cn } from "@/lib/cn";
import type { ServerStatus } from "@/lib/types";

export default function NodeServersPage() {
  const { node } = useAdminNode();
  if (!node) return null;

  if (!node.servers.length) {
    return (
      <Card className="px-4 py-10 text-center text-sm text-muted-foreground">
        No servers are assigned to this node yet.
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {node.servers.map((server) => {
        const status = (server.status as ServerStatus) || "offline";
        const meta = statusMeta(status);
        return (
          <Card key={server.id} className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Link href={`/admin/servers/${server.id}`} className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{server.name}</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium",
                      statusPillClass(status),
                    )}
                  >
                    {meta.label}
                  </span>
                </div>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{server.allocation}</p>
              </Link>
              <p className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                <LimitMb value={server.memoryMb} /> RAM · <LimitMb value={server.diskMb} /> disk
              </p>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
