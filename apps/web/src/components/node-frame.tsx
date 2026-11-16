"use client";

import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { QueryErrorPage } from "@/components/error-page";
import { SkeletonRoot } from "@/components/skeleton";
import { NodeDetailSkeleton } from "@/components/skeletons";
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
          {/* The node header carries its status rail, like a rack row. */}
          <div className="relative pl-4">
            {node ? (
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-0 left-0 w-[3px]",
                  node.maintenanceMode
                    ? "bg-status-warn"
                    : node.online
                      ? "bg-status-running"
                      : "bg-status-error",
                )}
              />
            ) : (
              <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-border" />
            )}
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h1 className="text-[31px] font-semibold">{node?.name ?? "Node"}</h1>
              {node ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-2 text-[13px] font-medium",
                    node.online ? "text-status-running" : "text-status-error",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("size-2 rounded-full", node.online ? "bg-status-running" : "bg-status-error")}
                  />
                  {node.online ? "Online" : "Offline"}
                </span>
              ) : null}
              {node?.maintenanceMode ? (
                <span className="inline-flex items-center gap-2 text-[13px] font-medium text-status-warn">
                  <span aria-hidden className="size-2 rounded-full bg-status-warn" />
                  In maintenance
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 font-mono text-[13px] text-muted-foreground">{node?.fqdn ?? "\u00a0"}</p>
          </div>
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

        {node ? children : (
          <SkeletonRoot>
            <NodeDetailSkeleton />
          </SkeletonRoot>
        )}
      </div>
    </NodeContext.Provider>
  );
}
