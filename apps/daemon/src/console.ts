import type { WSContext } from "hono/ws";
import type { DaemonConfig } from "./config";
import {
  attachConsole,
  classifyContainerExit,
  containerRunning,
  followLogs,
  getLogs,
  injectContainerLog,
  inspectContainer,
  isInstallRunning,
  killContainer,
  liveResources,
  readLastExit,
  recordLastExit,
  sendCommand,
  setConsoleEvent,
  setConsoleNotice,
  setConsoleReset,
  setConsoleWriter,
  stripAttachNoise,
} from "./docker";
import { getProcessState, setProcessState, setStatusBroadcast } from "./process-state";

const MAX_HISTORY = 200;

type Listener = (event: string, data: string) => void;

type Session = {
  listeners: Set<Listener>;
  history: string[];
  write: ((command: string) => boolean) | null;
  abort: AbortController | null;
  resetAt: number | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  seedPromise: Promise<void> | null;
  crashed: boolean;
};

const sessions = new Map<string, Session>();
const pendingNotices = new Map<string, string[]>();
const IDLE_MS = 45_000;

setConsoleWriter((uuid, command) => {
  const write = sessions.get(uuid)?.write;
  return write ? write(command) : false;
});

setConsoleNotice((uuid, message) => {
  consoleNotice(uuid, message);
});

setConsoleReset((uuid) => {
  clearConsole(uuid);
});

function clock(date = new Date()) {
  return date.toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function consoleNotice(uuid: string, message: string) {
  emitOutput(uuid, `[${clock()}] [Flutter] ${message}`);
  void injectContainerLog(uuid, `[Flutter] ${message}`).catch(() => undefined);
}

export function clearConsole(uuid: string) {
  const current = sessions.get(uuid);
  if (current) {
    current.history = [];
    current.resetAt = Date.now();
    current.seedPromise = null;
    current.crashed = false;
    for (const listener of current.listeners) listener("cleared", "");
    return;
  }
  pendingNotices.delete(uuid);
  sessions.set(uuid, {
    listeners: new Set(),
    history: [],
    write: null,
    abort: null,
    resetAt: Date.now(),
    idleTimer: null,
    seedPromise: null,
    crashed: false,
  });
}

function sendWs(ws: WSContext, event: string, data: string) {
  if (Number(ws.readyState) !== 1) return;
  ws.send(JSON.stringify({ event, data }));
}

function session(uuid: string) {
  let current = sessions.get(uuid);
  if (!current) {
    current = {
      listeners: new Set(),
      history: [...(pendingNotices.get(uuid) ?? [])],
      write: null,
      abort: null,
      resetAt: null,
      idleTimer: null,
      seedPromise: null,
      crashed: false,
    };
    pendingNotices.delete(uuid);
    sessions.set(uuid, current);
  }
  return current;
}

function emit(uuid: string, event: string, data: string) {
  const current = sessions.get(uuid);
  if (!current) return;
  if (event === "output") {
    current.history.push(data);
    if (current.history.length > MAX_HISTORY) {
      current.history.splice(0, current.history.length - MAX_HISTORY);
    }
  }
  for (const listener of current.listeners) listener(event, data);
}

setStatusBroadcast((uuid, state) => {
  emit(uuid, "status", state);
});

setConsoleEvent((uuid, event, data) => {
  emit(uuid, event, data);
});

function flutterKey(line: string) {
  const match = /\[Flutter\]\s+(.*)$/.exec(line);
  return match ? match[1] : null;
}

function isNoise(line: string) {
  const cleaned = stripAttachNoise(line);
  return !cleaned || (cleaned.startsWith("{") && cleaned.includes('"hijack"'));
}

function lineBody(line: string) {
  return stripAttachNoise(line).replace(/^\[\d{2}:\d{2}:\d{2}\]\s+/, "");
}

function rememberLine(history: string[], line: string) {
  if (!line || isNoise(line)) return false;
  const body = lineBody(line);
  if (!body) return false;
  if (history.at(-1) === line || lineBody(history.at(-1) ?? "") === body) return false;
  if (history.slice(-80).includes(line)) return false;
  const key = flutterKey(line);
  if (key && history.slice(-8).some((row) => flutterKey(row) === key)) return false;
  history.push(line);
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  return true;
}

function emitOutput(uuid: string, line: string) {
  const current = sessions.get(uuid);
  if (!current) {
    const queue = pendingNotices.get(uuid) ?? [];
    if (!rememberLine(queue, line)) return;
    if (queue.length > 40) queue.splice(0, queue.length - 40);
    pendingNotices.set(uuid, queue);
    return;
  }
  if (!rememberLine(current.history, line)) return;
  for (const listener of current.listeners) listener("output", line);
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function sendConsoleCommand(uuid: string, command: string) {
  const value = command.trim();
  if (!value) return;
  await sendCommand(uuid, value);
}

async function attachStdinStream(uuid: string, current: Session, signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      await attachConsole(
        uuid,
        (line) => emitOutput(uuid, line),
        signal,
        (write) => {
          current.write = write;
        },
      );
    } catch {
      current.write = null;
    }
    current.write = null;
    if (signal.aborted) return;
    await sleep(400, signal);
  }
}

async function seedLogs(uuid: string) {
  try {
    const current = session(uuid);
    const generation = current.resetAt;
    // A fresh start/restart just wiped the buffer. Don't pull previous
    // container logs back into the empty console.
    if (generation && Date.now() - generation < 2_000) return;
    const since = generation ? Math.floor(generation / 1000) : undefined;
    const { lines } = await getLogs(uuid, since ? 80 : 120, since);
    if (sessions.get(uuid)?.resetAt !== generation) return;
    for (const line of lines) emitOutput(uuid, line);
  } catch {
    /* docker may be down */
  }
}

async function flushContainerLogs(uuid: string) {
  await seedLogs(uuid);
  const current = sessions.get(uuid);
  if (!current?.history.length) return;
  const snapshot = JSON.stringify(current.history);
  for (const listener of current.listeners) listener("history", snapshot);
}

/** SIGINT 130 / SIGKILL 137 / SIGTERM 143 — Flutter stop/kill, not a crash. */
function isStopSignalExit(code: number) {
  return code === 130 || code === 137 || code === 143;
}

async function finishAttach(uuid: string) {
  await new Promise<void>((resolve) => setTimeout(resolve, 150));
  await flushContainerLogs(uuid);
  const after = await inspectContainer(uuid, true).catch(() => null);
  const state = after?.State;
  if (state?.Running) return "running" as const;

  const code = state?.ExitCode ?? 0;
  const process = getProcessState(uuid);
  const stopping = process === "stopping";
  if (state && !state.OOMKilled && (stopping || isStopSignalExit(code))) {
    const exit = classifyContainerExit(state, stopping);
    if (exit) void recordLastExit(uuid, exit);
    return "offline" as const;
  }

  if (state?.OOMKilled || code !== 0) {
    const exit = classifyContainerExit(state, false);
    const reason = exit?.message
      ? exit.message
      : state?.OOMKilled
        ? "Server ran out of memory"
        : state?.Error?.trim()
          ? state.Error
          : `Server crashed (exit ${code})`;
    if (exit) void recordLastExit(uuid, exit);
    emit(uuid, "error", reason);
    consoleNotice(uuid, reason);
    await killContainer(uuid);
    return "crashed" as const;
  }
  return "offline" as const;
}

async function attachLive(uuid: string, signal: AbortSignal) {
  const info = await inspectContainer(uuid);
  if (!info?.State.Running) return finishAttach(uuid);
  const current = session(uuid);
  const local = new AbortController();
  const onAbort = () => local.abort();
  if (signal.aborted) return "offline" as const;
  signal.addEventListener("abort", onAbort, { once: true });

  const since = current.resetAt ? Math.floor(current.resetAt / 1000) : undefined;
  const seeding = current.seedPromise ??= seedLogs(uuid);
  const recentReset = Boolean(current.resetAt && Date.now() - current.resetAt < 15_000);

  try {
    await Promise.all([
      attachStdinStream(uuid, current, local.signal).finally(() => local.abort()),
      followLogs(uuid, (line) => emitOutput(uuid, line), local.signal, {
        tail: recentReset ? 1 : 80,
        since,
      })
        .catch(() => undefined)
        .finally(() => local.abort()),
      seeding.catch(() => undefined),
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
    current.write = null;
    if (current.seedPromise === seeding) current.seedPromise = null;
  }

  // Docker often closes the follow/attach stream before the last stderr
  // frame (egg syntax errors, missing binaries) is delivered. Pull the
  // persisted logs and push any missing lines before crash notices.
  return finishAttach(uuid);
}

async function pump(config: DaemonConfig, uuid: string) {
  const current = session(uuid);
  const abort = new AbortController();
  current.abort = abort;
  const { signal } = abort;

  const tickStats = async () => {
    const live = await liveResources(config, uuid).catch(() => null);
    emit(
      uuid,
      "stats",
      JSON.stringify({
        cpuPercent: live?.stats?.cpuPercent ?? 0,
        memoryBytes: live?.stats?.memoryBytes ?? 0,
        diskBytes: live?.diskBytes ?? 0,
        rxBytes: live?.stats?.rxBytes ?? 0,
        txBytes: live?.stats?.txBytes ?? 0,
        startedAt: live?.startedAt ?? null,
      }),
    );
  };
  void sleep(400, signal).then(() => {
    if (!signal.aborted) void tickStats();
  });
  const statsTimer = setInterval(() => void tickStats(), 1000);
  signal.addEventListener("abort", () => clearInterval(statsTimer), { once: true });

  while (!signal.aborted) {
    if (current.crashed) {
      setProcessState(uuid, "offline");
      await sleep(500, signal);
      continue;
    }

    const installing = isInstallRunning(uuid);
    const running = await containerRunning(uuid).catch(() => false);
    const process = getProcessState(uuid);

    if (installing) {
      if (process !== "offline") setProcessState(uuid, "offline");
      await sleep(250, signal);
      continue;
    }

    if (process === "starting") {
      if (running) setProcessState(uuid, "running");
      else await sleep(250, signal);
      if (!running || signal.aborted) continue;
    } else if (process === "stopping") {
      if (!running) setProcessState(uuid, "offline");
      await sleep(250, signal);
      continue;
    } else if (running && process !== "running") {
      setProcessState(uuid, "running");
    } else if (!running && process === "running") {
      setProcessState(uuid, "offline");
    }

    if (!running) {
      await sleep(250, signal);
      continue;
    }

    const result = await attachLive(uuid, signal).catch((error) => {
      emit(uuid, "error", error instanceof Error ? error.message : "Console attach failed");
      return "error" as const;
    });

    if (signal.aborted) break;

    if (result === "crashed" || result === "error") {
      current.crashed = true;
      setProcessState(uuid, "offline");
      if (result === "error") {
        const still = await containerRunning(uuid).catch(() => false);
        if (still) {
          emit(uuid, "error", "Critical console error — stopping the server");
          consoleNotice(uuid, "Critical console error — stopping the server");
          await killContainer(uuid);
        }
      }
      await sleep(400, signal);
    }
  }

  clearInterval(statsTimer);
  current.write = null;
  if (current.abort === abort) current.abort = null;
}

export async function runDaemonConsole(
  config: DaemonConfig,
  uuid: string,
  ws: WSContext,
  signal: AbortSignal,
) {
  const current = session(uuid);
  if (current.idleTimer) {
    clearTimeout(current.idleTimer);
    current.idleTimer = null;
  }
  const listener: Listener = (event, data) => sendWs(ws, event, data);
  current.listeners.add(listener);
  sendWs(ws, "status", getProcessState(uuid));
  void readLastExit(uuid).then((exit) => {
    if (exit && current.listeners.has(listener)) sendWs(ws, "last-exit", JSON.stringify(exit));
  });
  const seeding = current.seedPromise ??= seedLogs(uuid);
  if (!current.abort) void pump(config, uuid);
  void seeding.catch(() => undefined).then(() => {
    if (current.seedPromise === seeding) current.seedPromise = null;
    if (current.listeners.has(listener)) {
      sendWs(ws, "history", JSON.stringify(current.history));
    }
  });

  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener("abort", stop, { once: true });
  });

  current.listeners.delete(listener);
  if (current.listeners.size === 0) {
    current.idleTimer = setTimeout(() => {
      current.idleTimer = null;
      current.abort?.abort();
    }, IDLE_MS);
  }
}
