"use client";

import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ListSkeleton } from "@/components/admin-table";
import { QueryErrorPage } from "@/components/error-page";
import { cn } from "@/lib/cn";
import { useQuery } from "@/lib/query";

export type AdminNodeAllocation = {
  id: string;
  ip: string;
  port: number;
  alias: string;
  notes: string;
  assigned: boolean;
  serverId: string | null;
  serverName: string | null;
};

export type AdminNodeServer = {
  id: string;
  name: string;
  uuid: string;
  status: string;
  memoryMb: number;
  diskMb: number;
  cpuPercent: number;
  allocation: string;
};

export type AdminNode = {
  id: string;
  locationId: string;
  location: string;
  name: string;
  description: string;
  fqdn: string;
  public: boolean;
  scheme: "https" | "http";
  behindProxy: boolean;
  daemonBase: string;
  memoryMb: number;
  diskMb: number;
  cpuCores: number;
  memoryOverallocate: number;
  diskOverallocate: number;
  daemonPort: number;
  sftpPort: number;
  uploadLimitMb: number;
  maintenanceMode: boolean;
  daemonVersion: string | null;
  system: {
    hostname: string | null;
    platform: string | null;
    release: string | null;
    arch: string | null;
    cpuThreads: number;
    totalMemoryMb: number;
  };
  tokenPrefix: string | null;
  daemonListenUrl: string | null;
  lastHeartbeatAt: string | Date | null;
  createdAt: string | Date;
  online: boolean;
  memoryCommittedMb: number;
  diskCommittedMb: number;
  serverCount: number;
  allocations: AdminNodeAllocation[];
  servers: AdminNodeServer[];
};

type NodePayload = { data: { node: AdminNode } };

const NodeContext = createContext<{
  node: AdminNode | null;
  reload: () => Promise<unknown>;
}>({ node: null, reload: async () => undefined });

export function useAdminNode() {
  return useContext(NodeContext);
}

const TABS = [
  { suffix: "", label: "About" },
  { suffix: "/settings", label: "Settings" },
  { suffix: "/configuration", label: "Configuration" },
  { suffix: "/allocations", label: "Allocations" },
  { suffix: "/servers", label: "Servers" },
];

export function NodeFrame({ nodeId, children }: { nodeId: string; children: ReactNode }) {
  const pathname = usePathname();
  const { data, error, errorStatus, reload } = useQuery<NodePayload>(`/api/v1/admin/nodes/${nodeId}`);
  const node = data?.data.node ?? null;
  const base = `/admin/nodes/${nodeId}`;

  if (error && !node) {
    return (
      <QueryErrorPage
        error={error}
        status={errorStatus}
        onRetry={() => void reload()}
        homeHref="/admin/nodes"
        homeLabel="Back to nodes"
      />
    );
  }

  return (
    <NodeContext.Provider value={{ node, reload }}>
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div>
          <Link
            href="/admin/nodes"
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Nodes
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{node?.name ?? "Node"}</h1>
            {node ? (
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
            ) : null}
            {node?.maintenanceMode ? (
              <span className="inline-flex items-center rounded-full bg-status-warn/15 px-2 py-0.5 text-xs font-medium text-status-warn">
                Maintenance
              </span>
            ) : null}
          </div>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{node?.fqdn ?? "\u00a0"}</p>
        </div>

        <nav className="flex flex-wrap gap-1 border-b border-border pb-px">
          {TABS.map((tab) => {
            const href = `${base}${tab.suffix}`;
            const active =
              tab.suffix === ""
                ? pathname === base
                : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {node ? children : <ListSkeleton rows={3} />}
      </div>
    </NodeContext.Provider>
  );
}
