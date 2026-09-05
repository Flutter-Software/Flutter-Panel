"use client";

import { use, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type UIEvent } from "react";
import { Check, ChevronDown, ChevronUp, Copy, Loader2, Search, X } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { StatGraph } from "@/components/status";
import { PowerButtons } from "@/components/power-buttons";
import { useLiveServerStatus, usePolledServerRecord } from "@/components/server-frame";
import { api } from "@/lib/api";
import { browserConsoleSocketUrl } from "@/lib/console-socket";
import { formatLimitMb, formatMb, type ServerRecord, type ServerStatus } from "@/lib/types";
import { cn } from "@/lib/cn";
import { can } from "@/lib/access";
import { ansiSpans, isFlutterConsoleLine, splitConsoleLine, stripConsoleAnsi } from "@/lib/console-ansi";
import {
  commandsForServer,
  completeConsoleCommand,
  filterConsoleCommands,
  type ConsoleCommand,
} from "@/lib/console-commands";
import { toast } from "@/components/toast";
import { UnlimitedStat } from "@/components/unlimited";

const MAX_LINES = 400;
const HISTORY = 60;
const COMMAND_HISTORY = 100;
const FILTERS = [
  { value: "all", label: "All" },
  { value: "game", label: "Game" },
  { value: "flutter", label: "Flutter" },
] as const;

type ConsoleFilter = (typeof FILTERS)[number]["value"];

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
  return stripConsoleAnsi(line.replace(/^\[\d{2}:\d{2}:\d{2}\]\s+/, ""));
}

function HighlightedText({ text, query, active }: { text: string; query: string; active: boolean }) {
  const needle = query.trim();
  if (!needle) return text;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  if (parts.length === 1) return text;
  let used = false;
  return parts.map((part, index) => {
    if (part.toLowerCase() !== needle.toLowerCase()) return <span key={index}>{part}</span>;
    const current = active && !used;
    used = true;
    return (
      <mark
        key={index}
        className={cn(
          "rounded-sm px-0.5",
          current ? "bg-primary text-primary-foreground" : "bg-primary/25 text-foreground",
        )}
      >
        {part}
      </mark>
    );
  });
}

function ConsoleLine({
  line,
  query = "",
  active = false,
  copied = false,
  onCopyLine,
}: {
  line: string;
  query?: string;
  active?: boolean;
  copied?: boolean;
  onCopyLine?: (line: string) => void;
}) {
  const parts = splitConsoleLine(line);
  const body = parts.body;
  const needle = query.trim();
  const bodyNode = needle ? (
    <HighlightedText text={stripConsoleAnsi(body)} query={query} active={active} />
  ) : (
    ansiSpans(body).map((span, index) => (
      <span key={index} className={span.className || undefined}>
        {span.text}
      </span>
    ))
  );

  if (!stripConsoleAnsi(body).trim() && !parts.time) return null;

  return (
    <div className="whitespace-pre-wrap break-all">
      {parts.time ? (
        <>
          <button
            type="button"
            className={cn(
              "text-muted-foreground hover:text-foreground hover:underline",
              copied && "text-primary",
            )}
            title={copied ? "Copied" : "Copy this line"}
            onClick={() => onCopyLine?.(line)}
          >
            [{parts.time}]
          </button>{" "}
        </>
      ) : null}
      {parts.flutter ? (
        <>
          <span className="font-medium text-primary">[Flutter]</span>{" "}
        </>
      ) : null}
      <span>{bodyNode}</span>
    </div>
  );
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
  value: ReactNode;
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

function asProcessStatus(value?: string): ServerStatus | null {
  if (value === "offline" || value === "starting" || value === "running" || value === "stopping") {
    return value;
  }
  return null;
}

function graphsLive(status?: ServerStatus | null, startedAt?: string | null) {
  if (status === "running" || status === "starting" || status === "stopping") return true;
  return Boolean(startedAt);
}

function parseLastExit(raw: string): ServerRecord["lastExit"] {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ServerRecord["lastExit"];
    if (!value || typeof value !== "object" || typeof value.kind !== "string") return null;
    return value;
  } catch {
    return null;
  }
}

function commandHistoryKey(serverId: string) {
  return `flutter.console.history.${serverId}`;
}

function loadCommandHistory(serverId: string) {
  try {
    const raw = sessionStorage.getItem(commandHistoryKey(serverId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(-COMMAND_HISTORY);
  } catch {
    return [];
  }
}

function saveCommandHistory(serverId: string, commands: string[]) {
  try {
    sessionStorage.setItem(commandHistoryKey(serverId), JSON.stringify(commands.slice(-COMMAND_HISTORY)));
  } catch {
    /* ignore quota */
  }
}

function lastExitBanner(exit: NonNullable<ServerRecord["lastExit"]>) {
  switch (exit.kind) {
    case "oom":
      return { title: "Ran out of memory", detail: exit.message, tone: "error" as const };
    case "killed":
      return {
        title: exit.code === 137 ? "Killed from the panel" : "Stopped",
        detail: exit.message,
        tone: "muted" as const,
      };
    case "crash":
      return {
        title: typeof exit.code === "number" ? `Process exited (code ${exit.code})` : "Process exited",
        detail: exit.message,
        tone: "error" as const,
      };
    case "install_failed":
      return { title: "Install failed", detail: exit.message, tone: "error" as const };
  }
}

export default function ConsolePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const framed = usePolledServerRecord();
  const { setLiveStatus } = useLiveServerStatus();
  const [server, setServer] = useState<ServerRecord | null>(framed);
  const [command, setCommand] = useState("");
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [suggestFocused, setSuggestFocused] = useState(false);
  const [browseAll, setBrowseAll] = useState(false);
  const commandInput = useRef<HTMLInputElement>(null);
  const suggestList = useRef<HTMLUListElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [netRate, setNetRate] = useState(0);
  const [, setTick] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const ignoreScroll = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const jumpToMatch = useRef(false);
  const [atBottom, setAtBottom] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [filter, setFilter] = useState<ConsoleFilter>("all");
  const [copiedLine, setCopiedLine] = useState<number | null>(null);
  const [selectionCopy, setSelectionCopy] = useState<{ text: string; top: number; left: number } | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const lastNet = useRef<{ rx: number; tx: number; at: number } | null>(null);
  const statusRef = useRef(server?.status);
  const ignoreHistoryUntil = useRef(0);
  const commandHistory = useRef<string[]>([]);
  const historyCursor = useRef(-1);
  const draftCommand = useRef("");
  const [series, setSeries] = useState<StatSeries>(emptySeries);

  const commandCatalog = server ? commandsForServer(server) : [];
  const commandMatches = filterConsoleCommands(commandCatalog, browseAll && !command.trim() ? "" : command);

  statusRef.current = server?.status;

  useEffect(() => {
    setSuggestIndex(0);
  }, [command, browseAll, server?.egg]);

  useEffect(() => {
    const active = suggestList.current?.querySelector("[data-active='true']");
    if (active instanceof HTMLElement) active.scrollIntoView({ block: "nearest" });
  }, [suggestIndex, command, browseAll]);

  function applyStatus(status: ServerStatus) {
    setLiveStatus(status);
    setServer((current) => (current ? { ...current, status } : current));
  }

  useEffect(() => {
    return () => setLiveStatus(null);
  }, [setLiveStatus]);

  useEffect(() => {
    if (!framed) return;
    setServer((current) => {
      if (!current) return framed;
      const status =
        current.status === "installing" &&
        (framed.status === "offline" || framed.status === "install_failed")
          ? framed.status
          : current.status;
      return {
        ...framed,
        status,
        cpu: current.cpu,
        memory: current.memory,
        disk: current.disk.usedMb > 0 ? current.disk : framed.disk,
      };
    });
    if (
      statusRef.current === "installing" &&
      (framed.status === "offline" || framed.status === "install_failed")
    ) {
      setLiveStatus(framed.status);
    }
  }, [framed, setLiveStatus]);

  useEffect(() => {
    setSeries(emptySeries());
    lastNet.current = null;
    setLines([]);
    setHistoryLoaded(false);
    setFilter("all");
    setSelectionCopy(null);
    commandHistory.current = loadCommandHistory(id);
    historyCursor.current = -1;
    draftCommand.current = "";
    const tick = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(tick);
  }, [id]);

  useEffect(() => {
    let closed = false;
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
        const result = await api<{ data: { token: string; socket: string } }>(
          `/api/v1/client/servers/${id}/console/socket`,
        );
        if (closed) return;
        const url = browserConsoleSocketUrl(result.data.token, result.data.socket);
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
              ignoreHistoryUntil.current = Date.now() + 1_500;
              setHistoryLoaded(true);
              setLines([]);
              setSeries(emptySeries());
              lastNet.current = null;
              setNetRate(0);
              return;
            }
            if (parsed.event === "history") {
              if (Date.now() < ignoreHistoryUntil.current) {
                setHistoryLoaded(true);
                return;
              }
              try {
                const rows = parsed.data ? (JSON.parse(parsed.data) as string[]) : [];
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
              setHistoryLoaded(true);
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
                const diskMb =
                  typeof stats.diskBytes === "number"
                    ? Math.max(0, Math.round((stats.diskBytes / 1024 / 1024) * 10) / 10)
                    : null;
                if (diskMb !== null) {
                  setServer((current) =>
                    current ? { ...current, disk: { ...current.disk, usedMb: diskMb } } : current,
                  );
                }
                if (!graphsLive(statusRef.current, stats.startedAt)) return;
                setStartedAt(parseStarted(stats.startedAt));
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
              const status = asProcessStatus(parsed.data);
              if (!status) return;
              if (statusRef.current === "installing" || statusRef.current === "install_failed") return;
              if (status === "offline") {
                setStartedAt(null);
                lastNet.current = null;
              }
              applyStatus(status);
              return;
            }
            if (parsed.event === "install started") {
              applyStatus("installing");
              return;
            }
            if (parsed.event === "install completed") {
              applyStatus(parsed.data === "false" ? "install_failed" : "offline");
              return;
            }
            if (parsed.event === "last-exit") {
              setServer((current) => (current ? { ...current, lastExit: parseLastExit(parsed.data ?? "") } : current));
              return;
            }
            if (parsed.event === "error" && parsed.data) {
              if (/crashed \(exit|out of memory|process exited/i.test(parsed.data)) {
                setServer((current) => {
                  if (!current || current.status === "installing" || current.status === "install_failed") {
                    return current;
                  }
                  return { ...current, status: "offline" };
                });
                setLiveStatus("offline");
                return;
              }
              toast(parsed.data);
            }
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
        toast(err instanceof Error ? err.message : "Console socket failed");
        retryTimer = window.setTimeout(() => {
          retryMs = Math.min(4_000, retryMs * 1.5);
          void connect();
        }, retryMs);
      }
    };

    void connect();
    const readyTimer = window.setTimeout(() => {
      if (!closed) setHistoryLoaded(true);
    }, 12_000);
    return () => {
      closed = true;
      window.clearTimeout(readyTimer);
      if (retryTimer) window.clearTimeout(retryTimer);
      ws?.close();
      socketRef.current = null;
    };
  }, [id]);

  const needle = searchQuery.trim();
  const visibleLines = useMemo(() => {
    return lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => {
        if (filter === "all") return true;
        const flutter = isFlutterConsoleLine(line);
        return filter === "flutter" ? flutter : !flutter;
      });
  }, [lines, filter]);

  const matchIndexes = useMemo(() => {
    if (!needle) return [];
    const lower = needle.toLowerCase();
    const indexes: number[] = [];
    for (let index = 0; index < visibleLines.length; index++) {
      const line = visibleLines[index]?.line;
      if (line && stripConsoleAnsi(line).toLowerCase().includes(lower)) {
        indexes.push(index);
      }
    }
    return indexes;
  }, [visibleLines, needle]);

  function scrollToBottom(behavior: ScrollBehavior = "auto") {
    const el = scroller.current;
    if (!el) return;
    ignoreScroll.current = true;
    stickToBottom.current = true;
    setAtBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior });
    if (behavior === "smooth") {
      window.setTimeout(() => {
        ignoreScroll.current = false;
      }, 400);
      return;
    }
    requestAnimationFrame(() => {
      if (scroller.current && stickToBottom.current) {
        scroller.current.scrollTop = scroller.current.scrollHeight;
      }
      ignoreScroll.current = false;
    });
  }

  function scrollToMatch(lineIndex: number) {
    const node = scroller.current?.querySelector(`[data-console-line="${lineIndex}"]`);
    if (!(node instanceof HTMLElement)) return;
    ignoreScroll.current = true;
    stickToBottom.current = false;
    node.scrollIntoView({ block: "nearest", behavior: "smooth" });
    window.setTimeout(() => {
      ignoreScroll.current = false;
      const el = scroller.current;
      if (!el) return;
      const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      stickToBottom.current = pinned;
      setAtBottom(pinned);
    }, 400);
  }

  function goToMatch(direction: 1 | -1) {
    if (matchIndexes.length === 0) return;
    jumpToMatch.current = true;
    setMatchIndex((current) => (current + direction + matchIndexes.length) % matchIndexes.length);
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setSearchOpen(false);
      return;
    }
    if (event.key !== "Enter" || matchIndexes.length === 0) return;
    event.preventDefault();
    goToMatch(event.shiftKey ? -1 : 1);
  }

  useLayoutEffect(() => {
    if (!stickToBottom.current) return;
    scrollToBottom();
  }, [visibleLines]);

  useEffect(() => {
    if (!searchOpen) {
      searchInput.current?.blur();
      return;
    }
    const timer = window.setTimeout(() => searchInput.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [searchOpen]);

  useEffect(() => {
    if (matchIndexes.length === 0) {
      if (matchIndex !== 0) setMatchIndex(0);
      return;
    }
    if (matchIndex >= matchIndexes.length) setMatchIndex(0);
  }, [matchIndexes, matchIndex]);

  useEffect(() => {
    if (!searchOpen || !jumpToMatch.current) return;
    jumpToMatch.current = false;
    if (matchIndexes.length === 0) return;
    const lineIndex = matchIndexes[Math.min(matchIndex, matchIndexes.length - 1)];
    if (lineIndex !== undefined) scrollToMatch(lineIndex);
  }, [searchOpen, searchQuery, matchIndex, matchIndexes]);

  function onScroll(event: UIEvent<HTMLDivElement>) {
    if (ignoreScroll.current) return;
    const el = event.currentTarget;
    const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickToBottom.current = pinned;
    setAtBottom(pinned);
    setSelectionCopy((current) => (current ? null : current));
  }

  useEffect(() => {
    const onSelection = () => {
      const selection = window.getSelection();
      const text = selection?.toString() ?? "";
      const pane = scroller.current;
      if (!selection || !text.trim() || !pane || selection.rangeCount === 0) {
        setSelectionCopy(null);
        return;
      }
      const node = selection.anchorNode;
      if (!node || !pane.contains(node)) {
        setSelectionCopy(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const box = pane.getBoundingClientRect();
      setSelectionCopy({
        text,
        top: Math.max(8, Math.min(box.height - 40, rect.top - box.top - 32)),
        left: Math.min(Math.max(8, rect.left - box.left), Math.max(8, box.width - 88)),
      });
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, []);

  async function power(action: "start" | "stop" | "restart" | "kill") {
    setError(null);
    if (action === "start" || action === "restart") {
      ignoreHistoryUntil.current = Date.now() + 1_500;
      setHistoryLoaded(true);
      setLines([]);
      setSeries(emptySeries());
      lastNet.current = null;
      setNetRate(0);
    }
    applyStatus(
      action === "start" ||
        (action === "restart" && (server?.status === "offline" || server?.status === "install_failed"))
        ? "starting"
        : "stopping",
    );
    try {
      const result = await api<{ data: { server: ServerRecord } }>(`/api/v1/client/servers/${id}/power`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      const next = result.data.server.status;
      if (next === "installing" || next === "install_failed") {
        applyStatus(next);
        setServer(result.data.server);
        return;
      }
      setServer((current) => {
        if (!current) return result.data.server;
        return {
          ...result.data.server,
          status: current.status,
          cpu: current.cpu,
          memory: current.memory,
        };
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Power action failed");
    }
  }

  async function sendCommand(event: FormEvent) {
    event.preventDefault();
    const value = command.trim();
    if (!value || !server || server.status === "installing") return;
    const list = commandHistory.current;
    if (list.at(-1) !== value) {
      list.push(value);
      if (list.length > COMMAND_HISTORY) list.splice(0, list.length - COMMAND_HISTORY);
      saveCommandHistory(id, list);
    }
    historyCursor.current = -1;
    draftCommand.current = "";
    setCommand("");
    setBrowseAll(false);
    setSuggestIndex(0);
    setError(null);
    setLines((current) => trimLines(current, [`> ${value}`]));
    const live =
      server.status === "running" || server.status === "starting" || server.status === "stopping";
    try {
      await api(`/api/v1/client/servers/${id}/command`, {
        method: "POST",
        body: JSON.stringify({ command: value, shell: !live }),
      });
    } catch (err) {
      if (live) {
        const socket = socketRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ event: "command", data: value }));
          return;
        }
      }
      toast(err instanceof Error ? err.message : "Could not send command");
    }
  }

  function acceptSuggestion(item: ConsoleCommand) {
    historyCursor.current = -1;
    draftCommand.current = "";
    setCommand(completeConsoleCommand(command, item.command));
    setBrowseAll(false);
    setSuggestIndex(0);
    commandInput.current?.focus();
  }

  function onCommandKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (browseAll || suggestFocused) {
        event.preventDefault();
        setBrowseAll(false);
        setSuggestFocused(false);
      }
      return;
    }
    if ((event.key === " " && event.ctrlKey) || (event.key === " " && event.metaKey)) {
      event.preventDefault();
      setBrowseAll(true);
      setSuggestFocused(true);
      setSuggestIndex(0);
      return;
    }
    const installing = server?.status === "installing";
    const matches = filterConsoleCommands(commandCatalog, browseAll && !command.trim() ? "" : command);
    const listOpen = Boolean(!installing && matches.length && (command.trim() || browseAll) && suggestFocused);
    if (listOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSuggestIndex((current) => Math.min(matches.length - 1, current + 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSuggestIndex((current) => Math.max(0, current - 1));
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const item = matches[suggestIndex] ?? matches[0];
        if (item) acceptSuggestion(item);
        return;
      }
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const list = commandHistory.current;
    if (!list.length) return;
    event.preventDefault();
    setBrowseAll(false);
    if (event.key === "ArrowUp") {
      if (historyCursor.current === -1) draftCommand.current = command;
      const next = historyCursor.current === -1 ? list.length - 1 : Math.max(0, historyCursor.current - 1);
      historyCursor.current = next;
      setCommand(list[next] ?? "");
      return;
    }
    if (historyCursor.current === -1) return;
    const next = historyCursor.current + 1;
    if (next >= list.length) {
      historyCursor.current = -1;
      setCommand(draftCommand.current);
      return;
    }
    historyCursor.current = next;
    setCommand(list[next] ?? "");
  }

  async function copyLastLines() {
    const chunk = visibleLines
      .slice(-50)
      .map((row) => stripConsoleAnsi(row.line))
      .join("\n");
    if (!chunk) return;
    try {
      await navigator.clipboard.writeText(chunk);
      setCopiedLogs(true);
      window.setTimeout(() => setCopiedLogs(false), 1200);
    } catch {
      /* ignore */
    }
  }

  async function copyPlain(text: string, lineIndex?: number) {
    const value = stripConsoleAnsi(text).trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(stripConsoleAnsi(text));
      if (lineIndex !== undefined) {
        setCopiedLine(lineIndex);
        window.setTimeout(() => setCopiedLine((current) => (current === lineIndex ? null : current)), 1200);
      }
    } catch {
      /* ignore */
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
  const suggestOpen = Boolean(
    canType && suggestFocused && commandMatches.length > 0 && (command.trim() || browseAll),
  );

  const lastExit = server?.lastExit ?? null;
  const showExit =
    Boolean(lastExit) && (server?.status === "offline" || server?.status === "install_failed");
  const exitMeta = lastExit ? lastExitBanner(lastExit) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PowerButtons
          status={server?.status}
          canStart={canStart}
          canRestart={canRestart}
          canStop={canStop}
          onPower={(action) => void power(action)}
        />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Console</p>
            <div className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Filter console lines">
              {FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={filter === option.value}
                  className={cn(
                    "h-6 rounded px-2 text-[11px] font-medium",
                    filter === option.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {showExit && exitMeta ? (
            <div
              className={cn(
                "flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2",
                exitMeta.tone === "error"
                  ? "border-status-error/30 bg-status-error/10"
                  : "border-border bg-muted/40",
              )}
            >
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-sm font-medium",
                    exitMeta.tone === "error" ? "text-status-error" : "text-foreground",
                  )}
                >
                  {exitMeta.title}
                </p>
                {exitMeta.detail && exitMeta.detail !== exitMeta.title ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{exitMeta.detail}</p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "shrink-0",
                  exitMeta.tone === "error" && "text-status-error hover:bg-status-error/15 hover:text-status-error",
                )}
                disabled={!lines.length}
                onClick={() => void copyLastLines()}
              >
                {copiedLogs ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copiedLogs ? "Copied" : "Copy last 50"}
              </Button>
            </div>
          ) : null}
          <div className="relative">
            <div
              ref={scroller}
              onScroll={onScroll}
              className={cn(
                "terminal-scroll relative h-[32rem] overflow-y-auto bg-background p-4 font-mono text-[13px] leading-6 text-foreground transition-[padding] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] select-text",
                searchOpen && "pb-14",
              )}
            >
              {historyLoaded
                ? visibleLines.map((row, visibleIndex) => (
                    <div
                      key={`${row.index}-${row.line.slice(0, 24)}`}
                      data-console-line={visibleIndex}
                      className={cn(
                        searchOpen &&
                          needle &&
                          matchIndexes[matchIndex] === visibleIndex &&
                          "rounded-sm bg-primary/10",
                      )}
                    >
                      <ConsoleLine
                        line={row.line}
                        query={searchOpen ? searchQuery : ""}
                        active={searchOpen && matchIndexes[matchIndex] === visibleIndex}
                        onCopyLine={() => void copyPlain(row.line, row.index)}
                        copied={copiedLine === row.index}
                      />
                    </div>
                  ))
                : null}
            </div>
            {!historyLoaded ? (
              <div
                className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-background"
                role="status"
                aria-live="polite"
              >
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading console history...</p>
              </div>
            ) : lines.length === 0 ? (
              <div className="pointer-events-none absolute inset-0 p-4 font-mono text-[13px] leading-6 text-muted-foreground">
                {running || starting || stopping
                  ? "Waiting for output…"
                  : installing
                    ? "Install is running. Output stays here if you refresh."
                    : "Server is offline. Press Start to boot the container."}
              </div>
            ) : visibleLines.length === 0 ? (
              <div className="pointer-events-none absolute inset-0 p-4 font-mono text-[13px] leading-6 text-muted-foreground">
                {filter === "flutter" ? "No Flutter lines in this buffer." : "No game lines in this buffer."}
              </div>
            ) : null}
            {selectionCopy ? (
              <button
                type="button"
                className="absolute z-30 inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs font-medium shadow-sm hover:bg-muted"
                style={{ top: selectionCopy.top, left: selectionCopy.left }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  void copyPlain(selectionCopy.text);
                  setSelectionCopy(null);
                  window.getSelection()?.removeAllRanges();
                }}
              >
                <Copy className="size-3" />
                Copy
              </button>
            ) : null}
            <div
              className={cn(
                "absolute bottom-3 right-3 z-20 flex h-8 max-w-[calc(100%-1.5rem)] items-center rounded-md",
                "transition-[background-color,border-color,box-shadow,backdrop-filter] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
                searchOpen
                  ? "border border-border bg-card/95 shadow-sm backdrop-blur-sm"
                  : "border border-transparent bg-transparent",
              )}
            >
              <button
                type="button"
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md bg-transparent text-muted-foreground",
                  searchOpen
                    ? "pointer-events-none"
                    : "hover:bg-muted hover:text-foreground",
                )}
                tabIndex={searchOpen ? -1 : 0}
                aria-hidden={searchOpen}
                aria-label={atBottom ? "Search console" : "Scroll to latest log"}
                title={atBottom ? "Search console" : "Scroll to latest"}
                onClick={() => {
                  if (atBottom) {
                    setSearchOpen(true);
                    return;
                  }
                  scrollToBottom("smooth");
                }}
              >
                {atBottom || searchOpen ? <Search className="size-4" /> : <ChevronDown className="size-4" />}
              </button>
              <div
                className={cn(
                  "grid min-w-0 transition-[grid-template-columns] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  searchOpen ? "grid-cols-[1fr]" : "grid-cols-[0fr]",
                )}
              >
                <div className="min-w-0 overflow-hidden" inert={searchOpen ? undefined : true}>
                  <div
                    className={cn(
                      "flex items-center gap-0.5 pr-0.5 transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
                      searchOpen ? "translate-x-0 opacity-100 delay-75" : "translate-x-1.5 opacity-0",
                    )}
                  >
                    <input
                      ref={searchInput}
                      type="text"
                      value={searchQuery}
                      onChange={(event) => {
                        jumpToMatch.current = true;
                        setMatchIndex(0);
                        setSearchQuery(event.target.value);
                      }}
                      onKeyDown={onSearchKeyDown}
                      placeholder="Find in console"
                      className="h-7 w-36 min-w-0 bg-transparent px-1.5 text-xs outline-none sm:w-44"
                      autoComplete="off"
                      spellCheck={false}
                      tabIndex={searchOpen ? 0 : -1}
                      aria-label="Find in console"
                    />
                    <span className="min-w-10 px-1 text-center text-[11px] tabular-nums text-muted-foreground">
                      {needle ? `${matchIndexes.length ? matchIndex + 1 : 0}/${matchIndexes.length}` : ""}
                    </span>
                    <button
                      type="button"
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                      aria-label="Previous match"
                      title="Previous match"
                      tabIndex={searchOpen ? 0 : -1}
                      disabled={!searchOpen || matchIndexes.length === 0}
                      onClick={() => goToMatch(-1)}
                    >
                      <ChevronUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                      aria-label="Next match"
                      title="Next match"
                      tabIndex={searchOpen ? 0 : -1}
                      disabled={!searchOpen || matchIndexes.length === 0}
                      onClick={() => goToMatch(1)}
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Close search"
                      title="Close search"
                      tabIndex={searchOpen ? 0 : -1}
                      onClick={() => setSearchOpen(false)}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <form className="relative flex items-center border-t border-border" onSubmit={(event) => void sendCommand(event)}>
            {suggestOpen ? (
              <ul
                ref={suggestList}
                id="console-command-suggest"
                role="listbox"
                className="absolute inset-x-0 bottom-full z-20 max-h-56 overflow-auto border-t border-border bg-card py-1 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.45)]"
              >
                {commandMatches.map((item, index) => {
                  const active = index === suggestIndex;
                  return (
                    <li key={item.command} role="presentation">
                      <button
                        type="button"
                        id={`console-command-option-${index}`}
                        role="option"
                        aria-selected={active}
                        data-active={active ? "true" : undefined}
                        className={cn(
                          "flex w-full items-baseline gap-3 px-4 py-1.5 text-left font-mono text-sm",
                          active ? "bg-primary/15 text-foreground" : "text-foreground hover:bg-muted/80",
                        )}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setSuggestIndex(index)}
                        onClick={() => acceptSuggestion(item)}
                      >
                        <span className="min-w-0 truncate">{item.command}</span>
                        <span className="ml-auto truncate text-xs font-sans text-muted-foreground">
                          {item.description}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <span className="pl-4 font-mono text-sm font-semibold text-primary" aria-hidden>
              $
            </span>
            <input
              ref={commandInput}
              value={command}
              onChange={(event) => {
                if (historyCursor.current !== -1) {
                  historyCursor.current = -1;
                  draftCommand.current = "";
                }
                setBrowseAll(false);
                setSuggestFocused(true);
                setCommand(event.target.value);
              }}
              onKeyDown={onCommandKeyDown}
              onFocus={() => setSuggestFocused(true)}
              onBlur={() => {
                window.setTimeout(() => setSuggestFocused(false), 120);
              }}
              className="h-11 flex-1 bg-transparent px-3 font-mono text-sm outline-none"
              placeholder={
                !canType
                  ? "Unavailable while installing"
                  : running || starting
                    ? "Type a command and press Enter…"
                    : "Run a command in the server image…"
              }
              disabled={!canType}
              autoComplete="off"
              spellCheck={false}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={suggestOpen}
              aria-controls={suggestOpen ? "console-command-suggest" : undefined}
              aria-activedescendant={
                suggestOpen ? `console-command-option-${suggestIndex}` : undefined
              }
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
            value={
              cpuLimit > 0 ? `${cpuUsed.toFixed(1)}/${cpuLimit}%` : <UnlimitedStat used={`${cpuUsed.toFixed(1)}%`} />
            }
            barValue={cpuUsed}
            barMax={cpuLimit > 0 ? cpuLimit : 100}
          />
          <SideStat
            label="Memory"
            value={
              memLimit > 0 ? `${memPct.toFixed(1)}/${100}%` : <UnlimitedStat used={formatMb(memUsed)} />
            }
            detail={memLimit > 0 ? `${formatMb(memUsed)} / ${formatLimitMb(memLimit)}` : undefined}
            barValue={memLimit > 0 ? memUsed : undefined}
            barMax={memLimit > 0 ? memLimit : undefined}
          />
          <SideStat
            label="Disk"
            value={
              diskLimit > 0 ? `${diskPct.toFixed(1)}/${100}%` : <UnlimitedStat used={formatMb(diskUsed)} />
            }
            detail={diskLimit > 0 ? `${formatMb(diskUsed)} / ${formatLimitMb(diskLimit)}` : undefined}
            barValue={diskLimit > 0 ? diskUsed : undefined}
            barMax={diskLimit > 0 ? diskLimit : undefined}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <StatGraph
            tall
            label="CPU"
            value={cpuUsed}
            max={cpuLimit > 0 ? cpuLimit : 100}
            display={
              cpuLimit > 0 ? (
                `${cpuUsed.toFixed(1)}% / ${cpuLimit}%`
              ) : (
                <UnlimitedStat used={`${cpuUsed.toFixed(1)}%`} />
              )
            }
            series={series.cpu}
            className="text-primary"
          />
        </Card>
        <Card className="p-4">
          <StatGraph
            tall
            label="Memory"
            value={memUsed}
            max={memLimit > 0 ? memLimit : Math.max(memUsed, 1)}
            display={
              memLimit > 0 ? (
                `${formatMb(memUsed)} / ${formatLimitMb(memLimit)}`
              ) : (
                <UnlimitedStat used={formatMb(memUsed)} />
              )
            }
            series={series.memory}
            className="text-status-running"
            warn={memLimit > 0}
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
