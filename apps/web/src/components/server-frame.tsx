"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { ServerSidebar } from "@/components/sidebar";
import { StatusDot } from "@/components/status";
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
  const path = `/api/v1/client/servers/${serverId}`;
  const { data, error, reload } = useQuery<ServerPayload>(path);
  const server = data?.data.server ?? null;

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
          <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">{children}</div>
        </div>
      </div>
    </ServerRecordContext.Provider>
  );
}
