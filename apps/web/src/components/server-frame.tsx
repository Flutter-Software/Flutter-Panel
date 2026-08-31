"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ServerSidebar } from "@/components/sidebar";
import { StatusDot } from "@/components/status";
import { useAuth } from "@/components/auth-provider";
import { ErrorPage, QueryErrorPage } from "@/components/error-page";
import { prefetchQuery, useQuery } from "@/lib/query";
import type { ServerRecord, ServerStatus } from "@/lib/types";

type ServerPayload = { data: { server: ServerRecord } };

const ServerRecordContext = createContext<ServerRecord | null>(null);
const LiveStatusContext = createContext<{
  liveStatus: ServerStatus | null;
  setLiveStatus: (status: ServerStatus | null) => void;
}>({ liveStatus: null, setLiveStatus: () => undefined });

export function useLiveServerStatus() {
  return useContext(LiveStatusContext);
}

export function useServerRecord() {
  const server = useContext(ServerRecordContext);
  const { liveStatus } = useContext(LiveStatusContext);
  if (!server) return null;
  if (!liveStatus) return server;
  return { ...server, status: liveStatus };
}

export function usePolledServerRecord() {
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
  const { data, error, errorStatus, reload } = useQuery<ServerPayload>(path);
  const [liveStatus, setLiveStatus] = useState<ServerStatus | null>(null);
  const polled = data?.data.server ?? null;
  const server = useMemo(() => {
    if (!polled) return null;
    if (!liveStatus) return polled;
    return { ...polled, status: liveStatus };
  }, [polled, liveStatus]);
  const maintenance = Boolean(server?.nodeMaintenance);
  const admin = user?.role === "admin";

  useEffect(() => {
    setLiveStatus(null);
  }, [serverId]);

  useEffect(() => {
    prefetchQuery(`/api/v1/client/servers/${serverId}/console/socket`);
    const timer = window.setInterval(() => {
      void reload();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [reload, serverId]);

  if (error && !server) {
    return (
      <QueryErrorPage
        error={error}
        status={errorStatus}
        onRetry={() => void reload()}
        homeHref="/"
        homeLabel="Back to server list"
      />
    );
  }

  if (maintenance && !admin && server) {
    return <ErrorPage kind="maintenance" homeHref="/" onRetry={() => void reload()} />;
  }

  return (
    <LiveStatusContext.Provider value={{ liveStatus, setLiveStatus }}>
      <ServerRecordContext.Provider value={polled}>
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
            <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">{children}</div>
          </div>
        </div>
      </ServerRecordContext.Provider>
    </LiveStatusContext.Provider>
  );
}
