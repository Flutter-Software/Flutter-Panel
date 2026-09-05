"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Box, Check, Copy, Cpu, Network, type LucideIcon } from "lucide-react";
import { ServerSidebar } from "@/components/sidebar";
import { StatusPill } from "@/components/status";
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
  const [copied, setCopied] = useState(false);
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
    setCopied(false);
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
            <header className="shrink-0 border-b border-border px-4 py-2.5 sm:px-6">
              <div className="flex items-center gap-3">
                <Link
                  href="/"
                  aria-label="Back to servers"
                  title="Servers"
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:block"
                >
                  <ArrowLeft className="size-4" />
                </Link>
                {server ? (
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                      <h1 className="min-w-0 truncate text-base font-semibold tracking-tight sm:text-lg">
                        {server.name}
                      </h1>
                      <StatusPill status={server.status} />
                    </div>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <HeaderMeta icon={Box}>{server.egg}</HeaderMeta>
                      <HeaderMeta icon={Cpu}>
                        {server.nodeLocation ? `${server.node} · ${server.nodeLocation}` : server.node}
                      </HeaderMeta>
                      {server.allocation && server.allocation !== "unassigned" ? (
                        <button
                          type="button"
                          className="no-press inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md py-0.5 font-mono hover:text-foreground"
                          onClick={() => {
                            void navigator.clipboard.writeText(server.allocation).then(
                              () => {
                                setCopied(true);
                                window.setTimeout(() => setCopied(false), 1200);
                              },
                              () => undefined,
                            );
                          }}
                          aria-label={copied ? "Address copied" : `Copy address ${server.allocation}`}
                          title={copied ? "Copied" : "Copy address"}
                        >
                          <Network className="size-3.5 shrink-0 opacity-70" aria-hidden />
                          <span className="truncate">{server.allocation}</span>
                          {copied ? (
                            <Check className="size-3 shrink-0 text-status-running" aria-hidden />
                          ) : (
                            <Copy className="size-3 shrink-0 opacity-50" aria-hidden />
                          )}
                        </button>
                      ) : (
                        <HeaderMeta icon={Network}>Unassigned</HeaderMeta>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-5 w-40 animate-pulse rounded-md bg-muted" />
                    <div className="h-3.5 w-56 animate-pulse rounded-md bg-muted/70" />
                  </div>
                )}
              </div>
            </header>
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

function HeaderMeta({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
      <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
      <span className="truncate">{children}</span>
    </span>
  );
}
