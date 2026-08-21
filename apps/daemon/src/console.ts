import type { WSContext } from "hono/ws";
import type { DaemonConfig } from "./config";
import {
  attachStdin,
  containerRunning,
  followLogs,
  getLogs,
  injectContainerLog,
  inspectContainer,
  killContainer,
  liveResources,
  sendCommand,
  setConsoleNotice,
  setConsoleReset,
  setConsoleWriter,
  stripAttachNoise,
} from "./docker";

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
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const write = sessions.get(uuid)?.write;
    if (write?.(value)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await sendCommand(uuid, value);
}

async function attachStdinStream(uuid: string, current: Session, signal: AbortSignal) {
  const stream = await attachStdin(uuid);
  current.write = (command) => {
    try {
      stream.write(command.endsWith("\n") || command === "\x03" ? command : `${command}\n`);
      return true;
    } catch {
      return false;
    }
  };
  await new Promise<void>((resolve) => {
    const stop = () => {
      current.write = null;
      stream.destroy?.();
      resolve();
    };
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener("abort", stop, { once: true });
    stream.on("end", stop);
    stream.on("error", stop);
    stream.resume?.();
  });
}

async function seedLogs(uuid: string) {
  const current = session(uuid);
  try {
    const since = current.resetAt ? Math.floor(current.resetAt / 1000) : undefined;
    const { lines } = await getLogs(uuid, since ? 400 : 120, since);
    for (const line of lines) rememberLine(current.history, line);
  } catch {
    /* docker may be down */
  }
}

async function attachLive(uuid: string, signal: AbortSignal) {
  const info = await inspectContainer(uuid);
  if (!info?.State.Running) return "offline" as const;
  const current = session(uuid);
  const local = new AbortController();
  const onAbort = () => local.abort();
  if (signal.aborted) return "offline" as const;
  signal.addEventListener("abort", onAbort, { once: true });

  const seeding = current.seedPromise ??= seedLogs(uuid);
  await seeding.catch(() => undefined);
  if (current.seedPromise === seeding) current.seedPromise = null;

  try {
    await Promise.all([
      attachStdinStream(uuid, current, local.signal).catch(() => undefined),
      followLogs(uuid, (line) => emitOutput(uuid, line), local.signal, { tail: 1 }).finally(() =>
        local.abort(),
      ),
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
    current.write = null;
  }

  const after = await inspectContainer(uuid).catch(() => null);
  const state = after?.State;
  if (state?.OOMKilled || (state && !state.Running && (state.ExitCode ?? 0) !== 0)) {
    const reason = state.OOMKilled
      ? "Server ran out of memory"
      : state.Error?.trim()
        ? state.Error
        : `Server crashed (exit ${state.ExitCode})`;
    emit(uuid, "error", reason);
    consoleNotice(uuid, reason);
    await killContainer(uuid);
    return "crashed" as const;
  }
  return state?.Running ? ("running" as const) : ("offline" as const);
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
    const running = await containerRunning(uuid).catch(() => false);
    emit(uuid, "status", running ? "running" : "offline");
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
      emit(uuid, "status", "offline");
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
  if (current.history.length) sendWs(ws, "history", JSON.stringify(current.history));
  const seeding = current.seedPromise ??= seedLogs(uuid);
  if (!current.abort) void pump(config, uuid);
  void seeding.catch(() => undefined).then(() => {
    if (current.seedPromise === seeding) current.seedPromise = null;
    if (current.history.length && current.listeners.has(listener)) {
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
