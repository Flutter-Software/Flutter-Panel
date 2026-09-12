"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/components/auth-provider";
import { api, HttpError } from "@/lib/api";
import { browserPanelSocketUrl } from "@/lib/console-socket";
import { loadQuery } from "@/lib/query";
import { invalidateQuery, peekQuery, updateQueries } from "@/lib/query-cache";
import type { ServerRecord, ServerStatus } from "@/lib/types";

type PanelSocketState = { connected: boolean };

const PanelSocketContext = createContext<PanelSocketState>({ connected: false });

type Frame = { event?: string; data?: unknown };
type ExtraHandler = (event: string, data: unknown) => void;

const extras = new Set<ExtraHandler>();

type ServerStatusPayload = {
  id: string;
  status: ServerStatus;
  lastExit?: ServerRecord["lastExit"];
  uptime?: string;
};

type ServerStatsPayload = {
  id: string;
  cpu: number;
  memoryMb: number;
  diskMb: number;
  status?: ServerStatus;
  uptime?: string;
};

type NodeStatusPayload = {
  id: string;
  online: boolean;
  lastHeartbeatAt?: string | null;
  maintenanceMode?: boolean;
  daemonVersion?: string | null;
  daemonListenUrl?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function asServer(value: unknown): ServerRecord | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return value as unknown as ServerRecord;
}

function patchServer(server: ServerRecord, patch: Partial<ServerRecord>): ServerRecord {
  return {
    ...server,
    ...patch,
    cpu: patch.cpu ? { ...server.cpu, ...patch.cpu } : server.cpu,
    memory: patch.memory ? { ...server.memory, ...patch.memory } : server.memory,
    disk: patch.disk ? { ...server.disk, ...patch.disk } : server.disk,
  };
}

function refetchCached(path: string) {
  if (peekQuery(path) === undefined) return;
  void loadQuery(path, true).catch(() => undefined);
}

function patchServers(id: string, mutate: (server: ServerRecord) => ServerRecord | null) {
  updateQueries((path, data) => {
    if (!isRecord(data) || !isRecord(data.data)) return undefined;
    const payload = data.data;
    if (path === "/api/v1/client/servers" || path === "/api/v1/admin/servers") {
      const rows = payload.servers;
      if (!Array.isArray(rows)) return undefined;
      let changed = false;
      const servers = rows.map((row) => {
        const server = asServer(row);
        if (!server || server.id !== id) return row;
        const next = mutate(server);
        if (!next) {
          changed = true;
          return null;
        }
        changed = true;
        return next;
      });
      if (!changed) return undefined;
      return { ...data, data: { ...payload, servers: servers.filter(Boolean) } };
    }
    if (
      path === `/api/v1/client/servers/${id}` ||
      path === `/api/v1/admin/servers/${id}`
    ) {
      const server = asServer(payload.server);
      if (!server) return undefined;
      const next = mutate(server);
      if (!next) return undefined;
      return { ...data, data: { ...payload, server: next } };
    }
    if (path.startsWith("/api/v1/admin/nodes/") && Array.isArray(payload.servers)) {
      let changed = false;
      const servers = payload.servers.map((row) => {
        if (!isRecord(row) || row.id !== id) return row;
        changed = true;
        const status = mutate(asServer({ ...row, id }) ?? (row as unknown as ServerRecord));
        return status ? { ...row, status: status.status } : row;
      });
      if (!changed) return undefined;
      return { ...data, data: { ...payload, servers } };
    }
    return undefined;
  });
}

function patchNodes(id: string, mutate: (node: Record<string, unknown>) => Record<string, unknown>) {
  updateQueries((path, data) => {
    if (!isRecord(data) || !isRecord(data.data)) return undefined;
    const payload = data.data;
    if (path === "/api/v1/admin/nodes") {
      const rows = payload.nodes;
      if (!Array.isArray(rows)) return undefined;
      let changed = false;
      const nodes = rows.map((row) => {
        if (!isRecord(row) || row.id !== id) return row;
        changed = true;
        return mutate(row);
      });
      if (!changed) return undefined;
      return { ...data, data: { ...payload, nodes } };
    }
    if (path === `/api/v1/admin/nodes/${id}`) {
      const node = payload.node;
      if (!isRecord(node) || node.id !== id) return undefined;
      return { ...data, data: { ...payload, node: mutate(node) } };
    }
    return undefined;
  });
}

function applyFrame(frame: Frame) {
  const event = frame.event;
  const data = frame.data;
  if (!event) return;

  if (event === "server.status" && isRecord(data) && typeof data.id === "string") {
    const payload = data as unknown as ServerStatusPayload;
    patchServers(payload.id, (server) =>
      patchServer(server, {
        status: payload.status,
        lastExit: payload.lastExit ?? server.lastExit,
        uptime: payload.uptime ?? server.uptime,
      }),
    );
  } else if (event === "server.stats" && isRecord(data) && typeof data.id === "string") {
    const payload = data as unknown as ServerStatsPayload;
    patchServers(payload.id, (server) =>
      patchServer(server, {
        status: payload.status ?? server.status,
        uptime: payload.uptime ?? server.uptime,
        cpu: { ...server.cpu, used: payload.cpu },
        memory: { ...server.memory, usedMb: payload.memoryMb },
        disk: payload.diskMb > 0 ? { ...server.disk, usedMb: payload.diskMb } : server.disk,
      }),
    );
  } else if (event === "server.removed" && isRecord(data) && typeof data.id === "string") {
    const id = data.id;
    patchServers(id, () => null);
    invalidateQuery(`/api/v1/client/servers/${id}`);
    invalidateQuery(`/api/v1/admin/servers/${id}`);
  } else if (event === "servers.changed") {
    refetchCached("/api/v1/client/servers");
    refetchCached("/api/v1/admin/servers");
    if (isRecord(data) && typeof data.id === "string") {
      refetchCached(`/api/v1/client/servers/${data.id}`);
      refetchCached(`/api/v1/admin/servers/${data.id}`);
    }
  } else if (event === "node.status" && isRecord(data) && typeof data.id === "string") {
    const payload = data as unknown as NodeStatusPayload;
    patchNodes(payload.id, (node) => ({
      ...node,
      online: payload.online,
      lastHeartbeatAt: payload.lastHeartbeatAt ?? node.lastHeartbeatAt,
      ...(payload.maintenanceMode !== undefined ? { maintenanceMode: payload.maintenanceMode } : {}),
      ...(payload.daemonVersion !== undefined ? { daemonVersion: payload.daemonVersion } : {}),
      ...(payload.daemonListenUrl !== undefined ? { daemonListenUrl: payload.daemonListenUrl } : {}),
    }));
    updateQueries((path, cached) => {
      if (path !== "/api/v1/client/servers" && path !== "/api/v1/admin/servers") return undefined;
      if (!isRecord(cached) || !isRecord(cached.data) || !Array.isArray(cached.data.servers)) return undefined;
      let changed = false;
      const servers = cached.data.servers.map((row) => {
        const server = asServer(row);
        if (!server || server.nodeId !== payload.id) return row;
        changed = true;
        return patchServer(server, {
          nodeOnline: payload.online,
          nodeMaintenance:
            payload.maintenanceMode !== undefined ? payload.maintenanceMode : server.nodeMaintenance,
          ...(payload.online
            ? {}
            : { cpu: { ...server.cpu, used: 0 }, memory: { ...server.memory, usedMb: 0 } }),
        });
      });
      if (!changed) return undefined;
      return { ...cached, data: { ...cached.data, servers } };
    });
    updateQueries((path, cached) => {
      if (!path.startsWith("/api/v1/client/servers/") && !path.startsWith("/api/v1/admin/servers/")) {
        return undefined;
      }
      if (!isRecord(cached) || !isRecord(cached.data)) return undefined;
      const server = asServer(cached.data.server);
      if (!server || server.nodeId !== payload.id) return undefined;
      return {
        ...cached,
        data: {
          ...cached.data,
          server: patchServer(server, {
            nodeOnline: payload.online,
            nodeMaintenance:
              payload.maintenanceMode !== undefined ? payload.maintenanceMode : server.nodeMaintenance,
          }),
        },
      };
    });
  } else if (event === "nodes.changed") {
    refetchCached("/api/v1/admin/nodes");
    if (isRecord(data) && typeof data.id === "string") {
      refetchCached(`/api/v1/admin/nodes/${data.id}`);
    }
  }

  extras.forEach((handler) => handler(event, data));
}

export function PanelSocketProvider({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const [connected, setConnected] = useState(false);
  const userId = user?.id ?? null;
  const closed = useRef(false);

  useEffect(() => {
    if (!ready || !userId) {
      setConnected(false);
      return;
    }
    closed.current = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let attempt = 0;

    const disconnect = () => {
      socket?.close();
      socket = null;
      setConnected(false);
    };

    const connect = async () => {
      if (closed.current) return;
      try {
        const result = await api<{ data: { token: string; socket: string } }>("/api/v1/client/panel/socket");
        if (closed.current) return;
        const url = browserPanelSocketUrl(result.data.token, result.data.socket);
        socket = new WebSocket(url);
        socket.onopen = () => {
          if (closed.current) return;
          attempt = 0;
          setConnected(true);
          refetchCached("/api/v1/client/servers");
          refetchCached("/api/v1/admin/servers");
          refetchCached("/api/v1/admin/nodes");
        };
        socket.onmessage = (event) => {
          try {
            applyFrame(JSON.parse(String(event.data)) as Frame);
          } catch {
            /* ignore malformed frames */
          }
        };
        socket.onclose = () => {
          setConnected(false);
          if (closed.current) return;
          const delay = Math.min(15_000, 400 * 2 ** attempt);
          attempt += 1;
          retryTimer = window.setTimeout(() => void connect(), delay);
        };
        socket.onerror = () => socket?.close();
      } catch (error) {
        setConnected(false);
        if (closed.current) return;
        if (error instanceof HttpError && error.status === 401) return;
        const delay = Math.min(15_000, 400 * 2 ** attempt);
        attempt += 1;
        retryTimer = window.setTimeout(() => void connect(), delay);
      }
    };

    void connect();
    return () => {
      closed.current = true;
      window.clearTimeout(retryTimer);
      disconnect();
    };
  }, [ready, userId]);

  const value = useMemo(() => ({ connected }), [connected]);
  return <PanelSocketContext.Provider value={value}>{children}</PanelSocketContext.Provider>;
}

export function usePanelSocket() {
  return useContext(PanelSocketContext);
}

export function usePanelEvent(event: string, handler: (data: unknown) => void) {
  const stable = useRef(handler);
  stable.current = handler;
  useEffect(() => {
    const extra: ExtraHandler = (name, data) => {
      if (name === event) stable.current(data);
    };
    extras.add(extra);
    return () => {
      extras.delete(extra);
    };
  }, [event]);
}

export function useLiveReload(reload: () => unknown, intervalMs: number, enabled = true) {
  const { connected } = usePanelSocket();
  useEffect(() => {
    if (!enabled || connected) return;
    const timer = window.setInterval(() => {
      try {
        void Promise.resolve(reload()).catch(() => undefined);
      } catch {
        /* reload threw synchronously */
      }
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [connected, enabled, intervalMs, reload]);
}
