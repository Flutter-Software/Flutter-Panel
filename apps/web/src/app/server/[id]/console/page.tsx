"use client";

import { use, useEffect, useRef, useState, type FormEvent, type UIEvent } from "react";
import { Play, RotateCcw, Square } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { StatGraph } from "@/components/status";
import { useServerRecord } from "@/components/server-frame";
import { api } from "@/lib/api";
import { peekQuery } from "@/lib/query";
import { formatMb, type ServerRecord, type ServerStatus } from "@/lib/types";
import { cn } from "@/lib/cn";
import { can } from "@/lib/access";

const MAX_LINES = 400;
const HISTORY = 60;

type StatSeries = { cpu: number[]; memory: number[]; network: number[] };

function emptySeries(): StatSeries {
  return { cpu: [], memory: [], network: [] };
}

function pushSeries(current: StatSeries, cpu: number, memory: number, network: number): StatSeries {
  const next = (values: number[], value: number) => {
    const copy = values.length >= HISTORY ? values.slice(values.length - HISTORY + 1) : values.slice();
    copy.push(value);
    return copy;
  };
  return {
    cpu: next(current.cpu, cpu),
    memory: next(current.memory, memory),
    network: next(current.network, network),
  };
}

function isAttachNoise(line: string) {
  return /"hijack"\s*:\s*true/.test(line) && /"stream"\s*:\s*true/.test(line);
}

function lineBody(line: string) {
  return line.replace(/^\[\d{2}:\d{2}:\d{2}\]\s+/, "");
}

function ConsoleLine({ line }: { line: string }) {
  const flutter = /^\[(\d{2}:\d{2}:\d{2})\] \[Flutter\] (.*)$/.exec(line);
  if (flutter) {
    return (
      <div className="whitespace-pre-wrap break-all">
        <span className="text-muted-foreground">[{flutter[1]}]</span>{" "}
        <span className="font-medium text-primary">[Flutter]</span>{" "}
        <span>{flutter[2]}</span>
      </div>
    );
  }
  const stamped = /^\[(\d{2}:\d{2}:\d{2})\] (.*)$/.exec(line);
  if (stamped) {
    return (
      <div className="whitespace-pre-wrap break-all">
        <span className="text-muted-foreground">[{stamped[1]}]</span> {stamped[2]}
      </div>
    );
  }
  return <div className="whitespace-pre-wrap break-all">{line}</div>;
}

function trimLines(current: string[], incoming: string[]) {
  const next =
    current.length + incoming.length > MAX_LINES
      ? current.slice(current.length + incoming.length - MAX_LINES)
      : current.slice();
  next.push(...incoming);
  if (next.length > MAX_LINES) return next.slice(-MAX_LINES);
  return next;
}

function parseStarted(value?: string | null) {
  if (!value) return null;
  const normalized = value.replace(/(\.\d{3})\d+/, "$1");
  const time = Date.parse(normalized);
  return Number.isNaN(time) ? null : time;
}

function formatUptime(startedMs: number | null, running: boolean) {
  if (!running || !startedMs) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatRate(bytesPerSec: number) {
  if (bytesPerSec < 1024) return `${Math.max(0, Math.round(bytesPerSec))} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
}

function SideStat({
  label,
  value,
  detail,
  barValue,
  barMax,
}: {
  label: string;
  value: string;
  detail?: string;
  barValue?: number;
  barMax?: number;
}) {
  const pct = barMax && barMax > 0 && barValue !== undefined ? Math.min(100, (barValue / barMax) * 100) : null;
  const tone =
    pct === null
      ? "bg-status-running"
      : pct >= 90
        ? "bg-status-error"
        : pct >= 70
          ? "bg-status-warn"
          : "bg-status-running";

  return (
    <Card className="p-3.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {detail ? <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p> : null}
      {pct !== null ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </Card>
  );
}

export default function ConsolePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const framed = useServerRecord();
  const [server, setServer] = useState<ServerRecord | null>(framed);
  const [command, setCommand] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [netRate, setNetRate] = useState(0);
  const [, setTick] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const socketRef = useRef<WebSocket | null>(null);
  const lastNet = useRef<{ rx: number; tx: number; at: number } | null>(null);
  const liveGraphs = useRef(false);
  const [series, setSeries] = useState<StatSeries>(emptySeries);

  async function loadServer() {
    const result = await api<{ data: { server: ServerRecord } }>(`/api/v1/client/servers/${id}`);
    setServer((current) => {
      const next = result.data.server;
      if (!current) return next;
      if (current.status === "starting" && next.status === "offline") return { ...next, status: "starting" };
      if (current.status === "stopping" && next.status === "running") return { ...next, status: "stopping" };
      const emptyLive =
        next.cpu.used === 0 &&
        next.memory.usedMb === 0 &&
        (current.cpu.used > 0 || current.memory.usedMb > 0);
      if (emptyLive) {
        return {
          ...next,
          cpu: current.cpu,
          memory: current.memory,
          disk: next.disk.usedMb > 0 ? next.disk : current.disk,
        };
      }
      return next;
    });
    return result.data.server;
  }

  useEffect(() => {
    if (framed) {
      setServer((current) => current ?? framed);
    }
  }, [framed]);

  useEffect(() => {
    liveGraphs.current = server?.status === "running" || server?.status === "starting";
  }, [server?.status]);

  useEffect(() => {
    setSeries(emptySeries());
    lastNet.current = null;
    loadServer().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
    const poll = window.setInterval(() => {
      loadServer().catch(() => undefined);
    }, 2000);
    const tick = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [id]);

  useEffect(() => {
    let closed = false;
    let skipCache = false;
    let retryMs = 400;
    let retryTimer: number | undefined;
    let ws: WebSocket | null = null;

    const push = (line: string) => {
      if (isAttachNoise(line)) return;
      setLines((current) => {
        const body = lineBody(line);
        if (!body || lineBody(current.at(-1) ?? "") === body) return current;
        return trimLines(current, [line]);
      });
    };

    const connect = async () => {
      if (closed) return;
      try {
        const socketPath = `/api/v1/client/servers/${id}/console/socket`;
        const cached = skipCache ? undefined : peekQuery<{ data: { token: string; socket: string } }>(socketPath);
        skipCache = true;
        const result =
          cached ?? (await api<{ data: { token: string; socket: string } }>(socketPath));
        if (closed) return;
        const url = `${result.data.socket}?token=${encodeURIComponent(result.data.token)}`;
        ws = new WebSocket(url);
        socketRef.current = ws;
        ws.onopen = () => {
          if (closed) return;
          retryMs = 400;
          setError(null);
        };
        ws.onmessage = (event) => {
          try {
            const parsed = JSON.parse(String(event.data)) as { event?: string; data?: string };
            if (parsed.event === "cleared") {
              setLines([]);
              setSeries(emptySeries());
              lastNet.current = null;
              setNetRate(0);
              return;
            }
            if (parsed.event === "history" && parsed.data) {
              try {
                const rows = JSON.parse(parsed.data) as string[];
                if (Array.isArray(rows)) {
                  const next = rows.filter((line) => typeof line === "string" && !isAttachNoise(line));
                  setLines((current) => {
                    if (!current.length) return next;
                    const seen = new Set(next.map(lineBody));
                    const extra = current.filter((line) => {
                      const body = lineBody(line);
                      return body && !seen.has(body);
                    });
                    return extra.length ? [...next, ...extra] : next;
                  });
                }
              } catch {
                /* ignore */
              }
              return;
            }
            if (parsed.event === "output" && parsed.data !== undefined) {
              push(parsed.data);
              return;
            }
            if (parsed.event === "stats" && parsed.data) {
              try {
                const stats = JSON.parse(parsed.data) as {
                  cpuPercent?: number;
                  memoryBytes?: number;
                  diskBytes?: number;
                  rxBytes?: number;
                  txBytes?: number;
                  startedAt?: string | null;
                };
                const started = parseStarted(stats.startedAt);
                setStartedAt(started);
                if (!liveGraphs.current) return;
                const now = Date.now();
                let network = 0;
                if (typeof stats.rxBytes === "number" && typeof stats.txBytes === "number") {
                  const prev = lastNet.current;
                  const total = stats.rxBytes + stats.txBytes;
                  if (prev) {
                    const dt = Math.max(0.2, (now - prev.at) / 1000);
                    network = Math.max(0, (total - (prev.rx + prev.tx)) / dt);
                  }
                  lastNet.current = { rx: stats.rxBytes, tx: stats.txBytes, at: now };
                }
                setNetRate(network);
                setServer((current) => {
                  if (!current) return current;
                  const memoryMb =
                    typeof stats.memoryBytes === "number"
                      ? Math.max(0, Math.round((stats.memoryBytes / 1024 / 1024) * 10) / 10)
                      : current.memory.usedMb;
                  const diskMb =
                    typeof stats.diskBytes === "number"
                      ? Math.max(0, Math.round((stats.diskBytes / 1024 / 1024) * 10) / 10)
                      : current.disk.usedMb;
                  return {
                    ...current,
                    cpu: {
                      ...current.cpu,
                      used: typeof stats.cpuPercent === "number" ? stats.cpuPercent : current.cpu.used,
                    },
                    memory: { ...current.memory, usedMb: memoryMb },
                    disk: { ...current.disk, usedMb: diskMb },
                  };
                });
                setSeries((current) =>
                  pushSeries(
                    current,
                    typeof stats.cpuPercent === "number" ? stats.cpuPercent : 0,
                    typeof stats.memoryBytes === "number"
                      ? Math.max(0, Math.round((stats.memoryBytes / 1024 / 1024) * 10) / 10)
                      : 0,
                    network,
                  ),
                );
              } catch {
                /* ignore malformed stats */
              }
              return;
            }
            if (parsed.event === "status") {
              const status = parsed.data === "running" ? "running" : parsed.data === "offline" ? "offline" : null;
              if (!status) return;
              if (status === "offline") {
                setStartedAt(null);
                lastNet.current = null;
              }
              setServer((current) => {
                if (!current) return current;
                if (status === "offline" && current.status === "starting") return current;
                if (status === "running" && current.status === "stopping") return current;
                return { ...current, status };
              });
              return;
            }
            if (parsed.event === "error" && parsed.data) setError(parsed.data);
          } catch {
            push(String(event.data));
          }
        };
        ws.onclose = () => {
          socketRef.current = null;
          if (closed) return;
          retryTimer = window.setTimeout(() => {
            retryMs = Math.min(4_000, retryMs * 1.5);
            void connect();
          }, retryMs);
        };
        ws.onerror = () => {
          ws?.close();
        };
      } catch (err) {
        if (closed) return;
        setError(err instanceof Error ? err.message : "Console socket failed");
        retryTimer = window.setTimeout(() => {
          retryMs = Math.min(4_000, retryMs * 1.5);
          void connect();
        }, retryMs);
      }
    };

    void connect();
    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      ws?.close();
      socketRef.current = null;
    };
  }, [id]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  function onScroll(event: UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

  function applyStatus(status: ServerStatus) {
    setServer((current) => (current ? { ...current, status } : current));
  }

  async function power(action: "start" | "stop" | "restart") {
    setError(null);
    if (action === "start" || action === "restart") {
      setLines([]);
      setSeries(emptySeries());
      lastNet.current = null;
      setNetRate(0);
    }
    applyStatus(action === "stop" ? "stopping" : "starting");
    try {
      const result = await api<{ data: { server: ServerRecord } }>(`/api/v1/client/servers/${id}/power`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      setServer(result.data.server);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Power action failed");
      await loadServer().catch(() => undefined);
    }
  }

  async function sendCommand(event: FormEvent) {
    event.preventDefault();
    const value = command.trim();
    if (!value || !server || server.status === "installing") return;
    setCommand("");
    setLines((current) => trimLines(current, [`> ${value}`]));
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ event: "command", data: value }));
      return;
    }
    try {
      await api(`/api/v1/client/servers/${id}/command`, {
        method: "POST",
        body: JSON.stringify({ command: value }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send command");
    }
  }

  async function copyAddress() {
    const value = server?.allocation;
    if (!value || value === "unassigned") return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }

  if (error && !server) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  const installing = server?.status === "installing";
  const starting = server?.status === "starting";
  const stopping = server?.status === "stopping";
  const running = server?.status === "running";
  const canStart = can(server, "control.start");
  const canStop = can(server, "control.stop");
  const canRestart = can(server, "control.restart");
  const canType = !installing;
  const cpuUsed = server?.cpu.used ?? 0;
  const cpuLimit = server?.cpu.limit ?? 0;
  const memUsed = server?.memory.usedMb ?? 0;
  const memLimit = server?.memory.limitMb ?? 0;
  const diskUsed = server?.disk.usedMb ?? 0;
  const diskLimit = server?.disk.limitMb ?? 0;
  const memPct = memLimit > 0 ? (memUsed / memLimit) * 100 : 0;
  const diskPct = diskLimit > 0 ? (diskUsed / diskLimit) * 100 : 0;
  const netMax = Math.max(1, netRate, ...series.network);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {canStart ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={installing || starting || running}
              onClick={() => void power("start")}
            >
              <Play className="size-3.5" />
              {starting ? "Starting…" : "Start"}
            </Button>
          ) : null}
          {canRestart ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={installing || starting || stopping || !running}
              onClick={() => void power("restart")}
            >
              <RotateCcw className="size-3.5" />
              Restart
            </Button>
          ) : null}
          {canStop ? (
            <Button
              size="sm"
              variant="danger"
              disabled={installing || stopping || (!running && !starting)}
              onClick={() => void power("stop")}
            >
              <Square className="size-3.5" />
              {stopping ? "Stopping…" : "Stop"}
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <Card className="overflow-hidden">
          <div className="border-b border-border px-3 py-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Console</p>
          </div>
          <div
            ref={scroller}
            onScroll={onScroll}
            className="terminal-scroll h-[32rem] overflow-y-auto bg-background p-4 font-mono text-[13px] leading-6 text-foreground"
          >
            {lines.length === 0 ? (
              <div className="text-muted-foreground">
                {running || starting
                  ? "Waiting for output…"
                  : installing
                    ? "Install is running on the daemon. Output appears here after the container starts."
                    : "Server is offline. Press Start to boot the container."}
              </div>
            ) : (
              lines.map((line, index) => (
                <ConsoleLine key={`${index}-${line.slice(0, 24)}`} line={line} />
              ))
            )}
          </div>
          <form className="flex items-center border-t border-border" onSubmit={(event) => void sendCommand(event)}>
            <span className="pl-4 font-mono text-sm font-semibold text-primary" aria-hidden>
              $
            </span>
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              className="h-11 flex-1 bg-transparent px-3 font-mono text-sm outline-none"
              placeholder={canType ? "Type a command and press Enter…" : "Unavailable while installing"}
              disabled={!canType}
              autoComplete="off"
              spellCheck={false}
            />
          </form>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <button
            type="button"
            onClick={() => void copyAddress()}
            className="rounded-xl border border-border bg-card p-3.5 text-left transition-colors hover:border-primary/40"
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {copied ? "Copied" : "Address"}
            </p>
            <p className="mt-1 font-mono text-lg font-semibold">{server?.allocation ?? "—"}</p>
          </button>
          <SideStat label="Uptime" value={formatUptime(startedAt, Boolean(running))} />
          <SideStat
            label="CPU load"
            value={`${cpuUsed.toFixed(1)}/${cpuLimit}%`}
            barValue={cpuUsed}
            barMax={Math.max(cpuLimit, 1)}
          />
          <SideStat
            label="Memory"
            value={`${memPct.toFixed(1)}/${100}%`}
            detail={`${formatMb(memUsed)} / ${formatMb(memLimit)}`}
            barValue={memUsed}
            barMax={Math.max(memLimit, 1)}
          />
          <SideStat
            label="Disk"
            value={`${diskPct.toFixed(1)}/${100}%`}
            detail={`${formatMb(diskUsed)} / ${formatMb(diskLimit)}`}
            barValue={diskUsed}
            barMax={Math.max(diskLimit, 1)}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <StatGraph
            tall
            label="CPU"
            value={cpuUsed}
            max={Math.max(cpuLimit, 1)}
            display={`${cpuUsed.toFixed(1)}% / ${cpuLimit}%`}
            series={series.cpu}
            className="text-primary"
          />
        </Card>
        <Card className="p-4">
          <StatGraph
            tall
            label="Memory"
            value={memUsed}
            max={Math.max(memLimit, 1)}
            display={`${formatMb(memUsed)} / ${formatMb(memLimit)}`}
            series={series.memory}
            className="text-status-running"
          />
        </Card>
        <Card className="p-4">
          <StatGraph
            tall
            label="Network"
            value={netRate}
            max={netMax}
            display={formatRate(netRate)}
            series={series.network}
            className="text-status-info"
            warn={false}
          />
        </Card>
      </div>
    </div>
  );
}
