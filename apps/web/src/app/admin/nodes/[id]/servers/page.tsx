"use client";

import Link from "next/link";
import { useAdminNode } from "@/components/node-frame";
import { Card } from "@/components/ui";
import { statusMeta } from "@/components/status";
import { cn } from "@/lib/cn";
import { formatLimitMb, type ServerStatus } from "@/lib/types";

const STATUS_PILL: Record<string, string> = {
  running: "bg-status-running/15 text-status-running",
  starting: "bg-status-warn/15 text-status-warn",
  stopping: "bg-status-warn/15 text-status-warn",
  installing: "bg-status-info/15 text-status-info",
  install_failed: "bg-status-error/15 text-status-error",
  offline: "bg-muted text-status-offline",
};

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
                      STATUS_PILL[status] ?? STATUS_PILL.offline,
                    )}
                  >
                    {meta.label}
                  </span>
                </div>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{server.allocation}</p>
              </Link>
              <p className="text-sm text-muted-foreground">
                {formatLimitMb(server.memoryMb)} RAM · {formatLimitMb(server.diskMb)} disk
              </p>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
