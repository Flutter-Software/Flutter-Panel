"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { Wrench } from "lucide-react";
import { ServerSidebar } from "@/components/sidebar";
import { StatusDot } from "@/components/status";
import { useAuth } from "@/components/auth-provider";
import { prefetchQuery, useQuery } from "@/lib/query";
import type { ServerRecord } from "@/lib/types";

type ServerPayload = { data: { server: ServerRecord } };

const ServerRecordContext = createContext<ServerRecord | null>(null);

export function useServerRecord() {
  return useContext(ServerRecordContext);
}

export function ServerFrame({
  serverId,
  children,
}: {
  serverId: string;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const path = `/api/v1/client/servers/${serverId}`;
  const { data, error, reload } = useQuery<ServerPayload>(path);
  const server = data?.data.server ?? null;
  const maintenance = Boolean(server?.nodeMaintenance);
  const admin = user?.role === "admin";

  useEffect(() => {
    prefetchQuery(`/api/v1/client/servers/${serverId}/console/socket`);
    const timer = window.setInterval(() => {
      void reload();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [reload, serverId]);

  return (
    <ServerRecordContext.Provider value={server}>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ServerSidebar serverId={serverId} server={server} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border px-4 py-3 sm:px-6">
            <div>
              <Link href="/" className="text-xs text-primary hover:underline">
                Server list
              </Link>
              <div className="mt-1 flex items-center gap-2">
                <h1 className="text-lg font-semibold">{server?.name ?? "Server"}</h1>
                {server ? <StatusDot status={server.status} /> : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {server
                  ? `${server.egg} · ${server.node} · ${server.allocation}`
                  : error && !server
                    ? error
                    : "\u00a0"}
              </p>
            </div>
          </div>
          {maintenance && admin ? (
            <div className="shrink-0 border-b border-status-warn/30 bg-status-warn/10 px-4 py-2 text-sm text-status-warn sm:px-6">
              This node is in maintenance mode. Users cannot open their servers.
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
            {maintenance && !admin && server ? (
              <div className="mx-auto flex min-h-[60%] max-w-md flex-col items-center justify-center py-16 text-center">
                <span className="flex size-12 items-center justify-center rounded-xl bg-status-warn/15 text-status-warn">
                  <Wrench className="size-6" />
                </span>
                <h2 className="mt-4 text-xl font-semibold">Maintenance mode</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {server.node} is temporarily unavailable. Your server is still listed on the
                  dashboard — check back after maintenance is complete.
                </p>
                <Link href="/" className="mt-6 text-sm text-primary hover:underline">
                  Back to server list
                </Link>
              </div>
            ) : (
              children
            )}
          </div>
        </div>
      </div>
    </ServerRecordContext.Provider>
  );
}
