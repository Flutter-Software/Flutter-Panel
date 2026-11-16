"use client";

import Link from "next/link";
import { useAdminNode } from "@/components/node-frame";
import { EmptyState, Rack, RackRow } from "@/components/ui";
import { LedRail, StatusPill } from "@/components/status";
import { LimitMb } from "@/components/unlimited";
import type { ServerStatus } from "@/lib/types";

export default function NodeServersPage() {
  const { node } = useAdminNode();
  if (!node) return null;

  if (!node.servers.length) {
    return (
      <EmptyState
        title="No servers on this node"
        description="Create a server and pick this node to place it here."
      />
    );
  }

  return (
    <Rack label="Servers on this node">
      {node.servers.map((server) => {
        const status = (server.status as ServerStatus) || "offline";
        return (
          <RackRow key={server.id} className="flex-wrap gap-y-1 py-3">
            <LedRail status={status} />
            <div className="min-w-0 flex-1 pl-1">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
                <Link
                  href={`/admin/servers/${server.id}`}
                  className="truncate font-display text-[17px] font-semibold leading-tight hover:text-primary"
                >
                  {server.name}
                </Link>
                <StatusPill status={status} />
              </div>
              <p className="truncate font-mono text-[12.5px] text-muted-foreground">{server.allocation}</p>
            </div>
            <p className="pl-1 text-[13px] tabular-nums text-muted-foreground">
              <LimitMb value={server.memoryMb} /> RAM, <LimitMb value={server.diskMb} /> disk
            </p>
          </RackRow>
        );
      })}
    </Rack>
  );
}
