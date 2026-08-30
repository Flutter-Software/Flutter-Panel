import { createHash } from "node:crypto";
import { availableParallelism, cpus } from "node:os";
import Docker from "dockerode";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DaemonConfig } from "./config";

export type InstallSpec = {
  uuid: string;
  name: string;
  dockerImage: string;
  startup: string;
  stopCommand: string;
  installScript?: string;
  installImage?: string;
  environment: Record<string, string>;
  limits: { memoryBytes: number; diskBytes: number; cpuPercent: number; cpuPinning?: number };
  allocation: { ip: string; port: number };
  allocations?: { ip: string; port: number }[];
};

export type PowerAction = "start" | "stop" | "restart" | "kill";

const DEFAULT_STARTUP =
  'while true; do echo "[flutter] $(date -u +%H:%M:%S) running"; sleep 5; done';

let notifyConsole: ((uuid: string, message: string) => void) | null = null;
let resetConsole: ((uuid: string) => void) | null = null;

export function setConsoleNotice(notify: (uuid: string, message: string) => void) {
  notifyConsole = notify;
}

export function setConsoleReset(reset: (uuid: string) => void) {
  resetConsole = reset;
}

function notice(uuid: string, message: string) {
  notifyConsole?.(uuid, message);
}

function clock(date = new Date()) {
  return date.toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function parseDockerTime(value: string) {
  const normalized = value.replace(/(\.\d{3})\d+/, "$1");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function stripAttachNoise(text: string) {
  return text
    .replace(/\{[^{}]*"hijack"\s*:\s*true[^{}]*\}/g, "")
    .replace(/\{[^{}]*"stream"\s*:\s*true[^{}]*"stdin"\s*:\s*true[^{}]*\}/g, "")
    .trim();
}

/** Cursor-home / erase-line / color codes from npm and similar TTY installers. */
function sanitizeConsoleOutput(text: string) {
  let value = text.replace(/\r\n/g, "\n");
  value = value.replace(/\x1b\[[0-9;]*[GHf]/g, "\r");
  value = value.replace(/\x1b\[[0-9;]*[KJ]/g, "");
  value = value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
  value = value.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
  value = value.replace(/\x1b./g, "");
  // ESC sometimes arrives as `[`, leaving `[[1G` / `[[33m`.
  value = value.replace(/\[{1,2}\d*(?:;\d+)*[GHf]/g, "\r");
  value = value.replace(/\[{1,2}\d*[KJ]/g, "");
  value = value.replace(/\[{1,2}\d+(?:;\d+)*m/g, "");
  value = value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  return value;
}

function visibleConsoleLine(line: string) {
  const parts = line.split("\r");
  return (parts[parts.length - 1] ?? "").replace(/[ \t]+$/g, "");
}

function isProgressJunk(line: string) {
  const value = line.trim();
  if (!value) return true;
  if (/^[\s\\|/\-_.░▒▓█▌▐■▪●]+$/.test(value)) return true;
  return false;
}

function collapseConsoleBuffer(text: string) {
  const prepared = sanitizeConsoleOutput(text);
  const chunks = prepared.split("\n");
  const rest = visibleConsoleLine(chunks.pop() ?? "");
  const lines = chunks.map(visibleConsoleLine).filter((line) => line && !isProgressJunk(line));
  return { lines, rest };
}

export function formatDockerLogLine(line: string) {
  const trimmed = stripAttachNoise(line);
  if (!trimmed) return "";
  if (trimmed.startsWith("{") && trimmed.includes('"hijack"')) return "";
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)\s+(.*)$/s);
  const stamp = match ? parseDockerTime(match[1]) : null;
  const body = match ? match[2] : trimmed;
  const visible = visibleConsoleLine(sanitizeConsoleOutput(body)).trim();
  if (!visible || isProgressJunk(visible)) return "";
  return `[${stamp ? clock(stamp) : clock()}] ${visible}`;
}

function createDocker() {
  if (process.env.DOCKER_HOST) return new Docker();
  if (process.platform === "win32") {
    return new Docker({ socketPath: "//./pipe/docker_engine" });
  }
  return new Docker({ socketPath: "/var/run/docker.sock" });
}

const docker = createDocker();

export function containerName(uuid: string) {
  return `flutter-${uuid}`;
}

export function serverRoot(config: DaemonConfig, uuid: string) {
  return resolve(config.dataDir, "servers", uuid);
}

export function bindPath(hostPath: string) {
  const resolved = resolve(hostPath);
  return process.platform === "win32" ? resolved.replace(/\\/g, "/") : resolved;
}

export function flutterDir(root: string) {
  return join(root, ".flutter");
}

function isNotFound(error: unknown) {
  return Boolean(
    error && typeof error === "object" && (error as { statusCode?: number }).statusCode === 404,
  );
}

export async function pingDocker() {
  await docker.ping();
}

async function pullImage(image: string) {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch {
    // pull if missing
  }
  const stream = await docker.pull(image);
  await new Promise<void>((resolvePull, reject) => {
    docker.modem.followProgress(stream, (error: Error | null) => {
      if (error) reject(error);
      else resolvePull();
    });
  });
}

const inspectCache = new Map<string, { at: number; value: Awaited<ReturnType<Docker["getContainer"]> extends { inspect: () => Promise<infer T> } ? T : never> | null }>();

export function invalidateInspect(uuid: string) {
  inspectCache.delete(uuid);
}

export async function inspectContainer(uuid: string, fresh = false) {
  if (!fresh) {
    const hit = inspectCache.get(uuid);
    if (hit && Date.now() - hit.at < 300) return hit.value;
  }
  try {
    const value = await docker.getContainer(containerName(uuid)).inspect();
    inspectCache.set(uuid, { at: Date.now(), value });
    return value;
  } catch (error) {
    if (isNotFound(error)) {
      inspectCache.set(uuid, { at: Date.now(), value: null });
      return null;
    }
    throw error;
  }
}

export function dockerContainer(uuid: string) {
  return docker.getContainer(containerName(uuid));
}

export async function killContainer(uuid: string) {
  invalidateInspect(uuid);
  const info = await inspectContainer(uuid, true);
  if (!info) return;
  await signalContainer(info.Id, "SIGKILL");
  await withTimeout(docker.getContainer(info.Id).kill(), 2_000).catch(() => undefined);
  await waitUntilStopped(uuid, 2_000);
  invalidateInspect(uuid);
}

function hostCpuCount() {
  try {
    return Math.max(1, availableParallelism());
  } catch {
    return Math.max(1, cpus().length);
  }
}

function cpuLayout(cpuPercent: number, cpuPinning: number, salt = "") {
  const host = hostCpuCount();
  const unlimited = !(cpuPercent > 0);
  const pinCount = cpuPinning > 0 ? Math.min(host, Math.max(1, Math.floor(cpuPinning))) : 0;
  const quotaCores = unlimited ? 0 : Math.min(host, Math.max(1, Math.ceil(cpuPercent / 100)));
  const cores = pinCount || quotaCores || host;

  let cpuset: string | undefined;
  if (pinCount > 0) {
    let start = 0;
    for (let index = 0; index < salt.length; index += 1) {
      start = (start + salt.charCodeAt(index)) % host;
    }
    const pinned = Array.from({ length: pinCount }, (_, index) => (start + index) % host).sort((a, b) => a - b);
    cpuset = pinned.join(",");
  }

  return {
    cores,
    nanoCpus: unlimited ? undefined : quotaCores * 1e9,
    cpuShares: unlimited ? undefined : quotaCores * 1024,
    cpuset,
  };
}

function withCpuRuntimeEnv(env: Record<string, string>, cores: number) {
  const threads = String(cores);
  const javaFlag = `-XX:ActiveProcessorCount=${cores}`;
  const java = env.JAVA_TOOL_OPTIONS?.includes("ActiveProcessorCount")
    ? env.JAVA_TOOL_OPTIONS
    : [env.JAVA_TOOL_OPTIONS, javaFlag].filter(Boolean).join(" ").trim();
  return {
    ...env,
    SERVER_CPU: env.SERVER_CPU || String(cores * 100),
    P_SERVER_CORES: threads,
    UV_THREADPOOL_SIZE: env.UV_THREADPOOL_SIZE || threads,
    GOMAXPROCS: env.GOMAXPROCS || threads,
    OMP_NUM_THREADS: env.OMP_NUM_THREADS || threads,
    MKL_NUM_THREADS: env.MKL_NUM_THREADS || threads,
    JAVA_TOOL_OPTIONS: java,
  };
}

function specFingerprint(spec: InstallSpec) {
  return createHash("sha1")
    .update(
      JSON.stringify({
        restart: "no",
        cpuPolicy: 2,
        // 3 = Docker --init as the only tini; image ENTRYPOINT (often tini) is stripped.
        init: 3,
        userBind: 2,
        image: spec.dockerImage,
        startup: spec.startup,
        env: spec.environment,
        memoryBytes: spec.limits.memoryBytes,
        diskBytes: spec.limits.diskBytes,
        cpuPercent: spec.limits.cpuPercent,
        cpuPinning: spec.limits.cpuPinning ?? 0,
        ip: spec.allocation.ip,
        port: spec.allocation.port,
        allocations: spec.allocations ?? [],
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

function dockerPortMap(spec: InstallSpec) {
  const exposed: Record<string, object> = {};
  const bindings: Record<string, { HostIp: string; HostPort: string }[]> = {};
  for (const row of [spec.allocation, ...(spec.allocations ?? [])]) {
    const port = Number(row.port) || 0;
    if (port <= 0) continue;
    const ip = row.ip?.trim() || "0.0.0.0";
    const hostIp = ip === "0.0.0.0" || ip === "*" || ip === "::" ? "" : ip;
    for (const proto of ["tcp", "udp"] as const) {
      const key = `${port}/${proto}`;
      exposed[key] = {};
      bindings[key] = [{ HostIp: hostIp, HostPort: String(port) }];
    }
  }
  return { exposed, bindings };
}

async function applyCompute(containerId: string, spec: InstallSpec) {
  const compute = cpuLayout(spec.limits.cpuPercent, spec.limits.cpuPinning ?? 0, spec.uuid);
  const container = docker.getContainer(containerId);
  const memory = spec.limits.memoryBytes > 0 ? spec.limits.memoryBytes : 0;
  try {
    await container.update({
      Memory: memory,
      NanoCpus: compute.nanoCpus ?? 0,
      CpuShares: compute.cpuShares ?? 0,
      CpusetCpus: compute.cpuset ?? "",
    });
  } catch {
    await container
      .update({
        Memory: memory,
        NanoCpus: compute.nanoCpus ?? 0,
        CpuShares: compute.cpuShares ?? 0,
      })
      .catch(() => undefined);
  }
}

async function removeContainer(uuid: string) {
  const info = await inspectContainer(uuid);
  if (!info) return;
  await docker.getContainer(info.Id).remove({ force: true }).catch(() => undefined);
}

export function substitute(template: string, env: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => env[key] ?? "");
}

export function runtimeEnvironment(spec: InstallSpec): Record<string, string> {
  const memoryMb =
    spec.limits.memoryBytes > 0 ? Math.max(1, Math.round(spec.limits.memoryBytes / 1024 / 1024)) : 0;
  const ip = spec.allocation.ip?.trim() || "0.0.0.0";
  const port = String(spec.allocation.port || 0);
  const merged: Record<string, string> = {
    TZ: "UTC",
    ...spec.environment,
    STARTUP: spec.startup || "",
    SERVER_MEMORY: String(memoryMb),
    SERVER_IP: ip,
    SERVER_PORT: port,
    P_SERVER_UUID: spec.uuid,
    P_SERVER_ALLOCATION_LIMIT: String(spec.allocations?.length ?? 0),
  };
  (spec.allocations ?? []).forEach((row, index) => {
    const extra = Number(row.port) || 0;
    if (extra > 0) merged[`SERVER_PORT_${index + 1}`] = String(extra);
  });
  for (const [key, value] of Object.entries(merged)) {
    merged[key] = value.replace(/\r/g, "");
  }
  merged.STARTUP = substitute(merged.STARTUP || "", merged);
  const layout = cpuLayout(spec.limits.cpuPercent, spec.limits.cpuPinning ?? 0, spec.uuid);
  return withCpuRuntimeEnv(merged, layout.cores);
}

export async function saveSpec(root: string, spec: InstallSpec) {
  await mkdir(flutterDir(root), { recursive: true });
  await writeFile(join(flutterDir(root), "spec.json"), `${JSON.stringify(spec, null, 2)}\n`, "utf8");
}

export async function loadSpec(root: string): Promise<InstallSpec | null> {
  try {
    const raw = await readFile(join(flutterDir(root), "spec.json"), "utf8");
    return JSON.parse(raw) as InstallSpec;
  } catch {
    return null;
  }
}

export function mergeSpec(base: InstallSpec | null, incoming: InstallSpec): InstallSpec {
  if (!base) return incoming;
  return {
    ...base,
    ...incoming,
    dockerImage: incoming.dockerImage || base.dockerImage,
    startup: incoming.startup || base.startup,
    stopCommand: incoming.stopCommand || base.stopCommand,
    installScript: incoming.installScript || base.installScript,
    installImage: incoming.installImage || base.installImage,
    environment: { ...base.environment, ...incoming.environment },
    limits: {
      memoryBytes: incoming.limits.memoryBytes ?? base.limits.memoryBytes,
      diskBytes: incoming.limits.diskBytes ?? base.limits.diskBytes,
      cpuPercent: incoming.limits.cpuPercent ?? base.limits.cpuPercent,
      cpuPinning: incoming.limits.cpuPinning ?? base.limits.cpuPinning ?? 0,
    },
    allocation: {
      ip: incoming.allocation.ip || base.allocation.ip,
      port: incoming.allocation.port || base.allocation.port,
    },
    allocations: incoming.allocations ?? base.allocations ?? [],
  };
}

async function writeEggFiles(root: string, spec: InstallSpec) {
  await saveSpec(root, spec);
  await writeFile(
    join(flutterDir(root), "install.json"),
    JSON.stringify(
      {
        uuid: spec.uuid,
        name: spec.name,
        dockerImage: spec.dockerImage,
        startup: spec.startup,
        installedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

function unixNewlines(value: string) {
  return value.replace(/\r/g, "");
}

type ImageIdentity = { user: string; uid: number; gid: number };

function hostIdentity(): ImageIdentity {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const gid = typeof process.getgid === "function" ? process.getgid() : 0;
  return { user: `${uid}:${gid}`, uid, gid };
}

async function chownServerFiles(root: string, uid: number, gid: number) {
  if (uid === 0 && gid === 0) return;
  if (process.platform === "win32") return;
  await pullImage("alpine:3.20");
  const container = await docker.createContainer({
    Image: "alpine:3.20",
    Cmd: [
      "sh",
      "-c",
      `chown -R ${uid}:${gid} /mnt/server && chmod -R u+rwX /mnt/server`,
    ],
    HostConfig: {
      Binds: [`${bindPath(root)}:/mnt/server`],
      NetworkMode: "none",
    },
  });
  try {
    await container.start();
    const result = await container.wait();
    if (result.StatusCode !== 0) {
      throw new Error(`chown exited ${result.StatusCode}`);
    }
  } finally {
    await container.remove({ force: true }).catch(() => undefined);
  }
}

export async function ensureServerOwnership(root: string, uuid?: string) {
  const identity = hostIdentity();
  if (identity.uid === 0 && identity.gid === 0) return identity;
  try {
    if (uuid) notice(uuid, `Setting file ownership to ${identity.user}…`);
    await chownServerFiles(root, identity.uid, identity.gid);
  } catch (error) {
    const message = error instanceof Error ? error.message : "chown failed";
    if (uuid) notice(uuid, `Could not chown server files (${message}); continuing.`);
  }
  return identity;
}

async function runInstallScript(root: string, spec: InstallSpec) {
  const script = unixNewlines(spec.installScript ?? "").trim();
  if (!script) return;
  const image = spec.installImage?.trim() || "alpine:3.20";
  notice(spec.uuid, `Pulling install image ${image}…`);
  await pullImage(image);
  const env = runtimeEnvironment(spec);
  const body = unixNewlines(substitute(script, env)).replace(/^\uFEFF/, "");
  const contents = body.startsWith("#!") ? `${body}\n` : `#!/bin/sh\nset -e\n${body}\n`;
  await mkdir(flutterDir(root), { recursive: true });
  await writeFile(join(flutterDir(root), "install.sh"), contents.replace(/\r/g, ""), { encoding: "utf8" });
  const runner = [
    "tr -d '\\r' < /mnt/server/.flutter/install.sh > /tmp/flutter-install.sh",
    "if command -v bash >/dev/null 2>&1; then exec bash /tmp/flutter-install.sh; fi",
    "if command -v ash >/dev/null 2>&1; then exec ash /tmp/flutter-install.sh; fi",
    "exec sh /tmp/flutter-install.sh",
  ].join("; ");

  const container = await docker.createContainer({
    Image: image,
    Cmd: ["sh", "-c", runner],
    WorkingDir: "/mnt/server",
    Env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
    HostConfig: {
      Binds: [`${bindPath(root)}:/mnt/server`],
      AutoRemove: false,
      NetworkMode: "bridge",
    },
    Labels: { "flutter.server": spec.uuid, "flutter.role": "install" },
  });
  let stopLogs: (() => void) | undefined;
  try {
    notice(spec.uuid, "Running install script…");
    await container.start();
    const stream = (await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
    })) as NodeJS.ReadableStream & { destroy?: () => void };
    stopLogs = pipeInstallLogs(stream, spec.uuid);
    const result = await container.wait();
    stopLogs?.();
    stopLogs = undefined;
    if (result.StatusCode !== 0) {
      let logs = "";
      try {
        logs = decodeDockerLogs(await asBuffer((await container.logs({ stdout: true, stderr: true, tail: 80 })) as Buffer));
      } catch {
        /* ignore */
      }
      throw new Error(`Install script exited ${result.StatusCode}${logs ? `\n${logs}` : ""}`);
    }
  } finally {
    stopLogs?.();
    await container.remove({ force: true }).catch(() => undefined);
  }
}

type InstallJobStatus = {
  status: "installing" | "ok" | "failed";
  error?: string;
  startedAt: string;
  finishedAt?: string;
};

const installJobs = new Map<string, Promise<void>>();

function installStatusPath(root: string) {
  return join(flutterDir(root), "install-status.json");
}

async function writeInstallStatus(root: string, status: InstallJobStatus) {
  await mkdir(flutterDir(root), { recursive: true });
  await writeFile(installStatusPath(root), `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

async function readInstallStatus(root: string): Promise<InstallJobStatus | null> {
  try {
    return JSON.parse(await readFile(installStatusPath(root), "utf8")) as InstallJobStatus;
  } catch {
    return null;
  }
}

function pipeInstallLogs(stream: NodeJS.ReadableStream & { destroy?: () => void }, uuid: string) {
  let leftover: Buffer = Buffer.alloc(0);
  let text = "";
  let lastAt = 0;
  const emit = (line: string) => {
    const message = visibleConsoleLine(sanitizeConsoleOutput(stripAttachNoise(line))).replace(/\s+/g, " ").trim();
    if (!message || isProgressJunk(message)) return;
    const now = Date.now();
    const progress = /\d+%|\d+(\.\d+)?\s*(MiB|GiB|KiB|MB|GB|kB)/i.test(message);
    if (progress && now - lastAt < 400) return;
    lastAt = now;
    notice(uuid, message.slice(0, 500));
  };
  const onData = (chunk: Buffer | string) => {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const buf = leftover.length ? Buffer.concat([leftover, incoming]) : incoming;
    const decoded = decodeDockerFrames(buf);
    leftover = decoded.rest;
    text += decoded.text;
    const parts = collapseConsoleBuffer(text);
    text = parts.rest;
    for (const line of parts.lines) emit(line);
  };
  stream.on("data", onData);
  return () => {
    stream.off("data", onData);
    stream.destroy?.();
    if (text.trim()) emit(text);
  };
}

export async function installServer(config: DaemonConfig, spec: InstallSpec) {
  const image = spec.dockerImage?.trim() || "busybox:1.36";
  const root = serverRoot(config, spec.uuid);
  await mkdir(root, { recursive: true });
  const next = { ...spec, dockerImage: image };
  await writeEggFiles(root, next);
  notice(spec.uuid, `Pulling ${image}…`);
  await pullImage(image);
  await runInstallScript(root, next);
  await ensureServerOwnership(root, spec.uuid);
  return { installed: true, uuid: spec.uuid };
}

export async function startInstallServer(config: DaemonConfig, spec: InstallSpec) {
  const root = serverRoot(config, spec.uuid);
  if (installJobs.has(spec.uuid)) {
    return { started: true, uuid: spec.uuid };
  }
  const startedAt = new Date().toISOString();
  await mkdir(root, { recursive: true });
  await writeInstallStatus(root, { status: "installing", startedAt });
  const job = installServer(config, spec)
    .then(async () => {
      await writeInstallStatus(root, {
        status: "ok",
        startedAt,
        finishedAt: new Date().toISOString(),
      });
      notice(spec.uuid, "Install finished.");
    })
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      await writeInstallStatus(root, {
        status: "failed",
        error: message,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
      notice(spec.uuid, `Install failed: ${message.slice(0, 400)}`);
    })
    .finally(() => {
      installJobs.delete(spec.uuid);
    });
  installJobs.set(spec.uuid, job);
  return { started: true, uuid: spec.uuid };
}

export async function getInstallStatus(config: DaemonConfig, uuid: string): Promise<InstallJobStatus> {
  const root = serverRoot(config, uuid);
  const status = await readInstallStatus(root);
  if (!status) return { status: "failed", error: "Install has not started", startedAt: new Date().toISOString() };
  if (status.status === "installing" && !installJobs.has(uuid)) {
    return {
      ...status,
      status: "failed",
      error: status.error || "Daemon restarted during install",
      finishedAt: status.finishedAt || new Date().toISOString(),
    };
  }
  return status;
}

export async function destroyServer(config: DaemonConfig, uuid: string) {
  await removeContainer(uuid);
  await rm(serverRoot(config, uuid), { recursive: true, force: true });
  await rm(resolve(config.dataDir, "backups", uuid), { recursive: true, force: true });
  return { destroyed: true };
}

async function waitUntilStopped(uuid: string, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    invalidateInspect(uuid);
    if (!(await inspectContainer(uuid, true))?.State.Running) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
  }
  invalidateInspect(uuid);
  return !Boolean((await inspectContainer(uuid, true))?.State.Running);
}

function withTimeout<T>(promise: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function stopKind(command: string): "sigint" | "sigterm" | "sigkill" | "stdin" {
  const value = command.trim();
  if (!value) return "sigterm";
  const upper = value.toUpperCase().replace(/^SIG/, "");
  if (value === "^^C" || upper === "KILL") return "sigkill";
  if (upper === "TERM" || upper === "SIGTERM") return "sigterm";
  if (upper === "INT" || /^(\^C)+$/.test(value) || upper === "SIGINT") return "sigint";
  return "stdin";
}

async function signalContainer(id: string, signal: string) {
  await withTimeout(docker.getContainer(id).kill({ signal }), 3_000).catch(() => undefined);
}

async function stopRunning(uuid: string, stopCommand: string, graceMs: number) {
  invalidateInspect(uuid);
  const existing = await inspectContainer(uuid, true);
  if (!existing?.State.Running) return;
  const id = existing.Id;
  const kind = stopKind(stopCommand);

  if (kind === "sigkill") {
    await signalContainer(id, "SIGKILL");
  } else if (kind === "sigint") {
    const times = Math.max(1, (stopCommand.trim().match(/\^C/gi) ?? ["SIGINT"]).length);
    for (let index = 0; index < times; index += 1) {
      tryConsoleWrite?.(uuid, "\x03");
      await signalContainer(id, "SIGINT");
    }
  } else if (kind === "sigterm") {
    await signalContainer(id, "SIGTERM");
  } else {
    await withTimeout(sendCommand(uuid, stopCommand.trim()), 1_500).catch(() => undefined);
  }

  if (await waitUntilStopped(uuid, graceMs)) return;

  await withTimeout(docker.getContainer(id).stop({ t: 1 }), 4_000).catch(() => undefined);
  if (await waitUntilStopped(uuid, 1_500)) return;
  await signalContainer(id, "SIGKILL");
  await withTimeout(docker.getContainer(id).kill(), 2_000).catch(() => undefined);
  invalidateInspect(uuid);
}

export async function powerServer(config: DaemonConfig, spec: InstallSpec, action: PowerAction) {
  const uuid = spec.uuid;
  const name = containerName(uuid);
  const root = serverRoot(config, uuid);
  invalidateInspect(uuid);
  if (action === "stop" || action === "kill") stopStatsStream(uuid);
  if (action === "start" || action === "restart") {
    stopStatsStream(uuid);
    resetConsole?.(uuid);
  }
  notice(
    uuid,
    action === "restart"
      ? "Restarting server..."
      : action === "stop"
        ? "Stopping server..."
        : action === "kill"
          ? "Killing server..."
          : "Starting server...",
  );
  try {
    await mkdir(root, { recursive: true });
    const merged = mergeSpec(await loadSpec(root), spec);
    await saveSpec(root, merged);
    const image = merged.dockerImage?.trim() || "busybox:1.36";
    let identity = hostIdentity();
    if (action === "start" || action === "restart") {
      await pullImage(image);
      identity = await ensureServerOwnership(root, uuid);
    }
    const fingerprint = specFingerprint(merged);
    const existing = await inspectContainer(uuid);
    const sameSpec = existing?.Config.Labels?.["flutter.spec"] === fingerprint;

    const done = (status: "running" | "offline") => {
      invalidateInspect(uuid);
      notice(uuid, status === "running" ? "Server is running." : "Server is offline.");
      return { status, action };
    };

    const settleStarted = async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      invalidateInspect(uuid);
      const after = await inspectContainer(uuid, true);
      if (after?.State.Running) return done("running");
      const code = after?.State.ExitCode ?? 0;
      const dockerError = after?.State.Error?.trim();
      if (after?.State.OOMKilled) notice(uuid, "Server ran out of memory");
      else if (dockerError) notice(uuid, dockerError);
      else if (code !== 0) notice(uuid, `Server crashed (exit ${code})`);
      else notice(uuid, "Server process exited immediately.");
      return done("offline");
    };

    if (action === "kill") {
      if (existing) {
        await signalContainer(existing.Id, "SIGKILL");
        await withTimeout(docker.getContainer(existing.Id).kill(), 2_000).catch(() => undefined);
      }
      return done("offline");
    }

    if (action === "stop") {
      await stopRunning(uuid, merged.stopCommand ?? "", 2_000);
      return done("offline");
    }

    if (action === "start" && existing?.State.Running) {
      return settleStarted();
    }

    if (sameSpec && existing) {
      await applyCompute(existing.Id, merged);
      if (action === "restart" && existing.State.Running) {
        await docker.getContainer(existing.Id).restart({ t: 2 });
        return settleStarted();
      }
      if (!existing.State.Running) {
        await docker.getContainer(existing.Id).start();
        return settleStarted();
      }
    }

    if (existing) await removeContainer(uuid);

    const env = runtimeEnvironment(merged);
    const startup = env.STARTUP?.trim() || merged.startup?.trim() || DEFAULT_STARTUP;
    const command = startup.startsWith("exec ") ? startup : `exec ${startup}`;
    const hasStartup = Boolean(merged.startup?.trim() || env.STARTUP?.trim());
    const ports = dockerPortMap(merged);
    const compute = cpuLayout(merged.limits.cpuPercent, merged.limits.cpuPinning ?? 0, uuid);

    const container = await docker.createContainer({
      name,
      Image: image,
      User: identity.user,
      // Yolk images (steamcmd, java, …) ENTRYPOINT tini. Docker Init is PID 1;
      // leaving that entrypoint nests a second tini which warns and can exit
      // before the startup command runs. Images with an empty startup (itzg)
      // keep their own entrypoint.
      ...(hasStartup ? { Entrypoint: ["/bin/sh", "-c"], Cmd: [command] } : {}),
      Tty: true,
      OpenStdin: true,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: "/home/container",
      Env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
      ExposedPorts: ports.exposed,
      HostConfig: {
        Init: true,
        Binds: [`${bindPath(root)}:/home/container`],
        Memory: merged.limits.memoryBytes > 0 ? merged.limits.memoryBytes : 0,
        ...(compute.nanoCpus ? { NanoCpus: compute.nanoCpus } : {}),
        ...(compute.cpuShares ? { CpuShares: compute.cpuShares } : {}),
        ...(compute.cpuset ? { CpusetCpus: compute.cpuset } : {}),
        PortBindings: ports.bindings,
        RestartPolicy: { Name: "no" },
      },
      Labels: { "flutter.server": uuid, "flutter.spec": fingerprint },
    });
    await container.start();
    return settleStarted();
  } catch (error) {
    notice(
      uuid,
      error instanceof Error ? `Power action failed: ${error.message}` : "Power action failed.",
    );
    throw error;
  }
}

export async function containerRunning(uuid: string) {
  const info = await inspectContainer(uuid);
  return Boolean(info?.State.Running);
}

type DockerStatsJson = {
  read?: string;
  preread?: string;
  num_procs?: number;
  cpu_stats?: {
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: {
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
  };
  memory_stats?: {
    usage?: number;
    limit?: number;
    privateworkingset?: number;
    stats?: Record<string, number>;
  };
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>;
};

export type ContainerStats = {
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number | null;
  rxBytes: number;
  txBytes: number;
};

type ResourceCache = {
  at: number;
  running: boolean;
  stats: ContainerStats | null;
  diskBytes: number;
  diskAt: number;
};

const resourceCache = new Map<string, ResourceCache>();

function asStatsJson(value: unknown): DockerStatsJson | null {
  if (!value) return null;
  if (Buffer.isBuffer(value) || typeof value === "string") {
    const text = (Buffer.isBuffer(value) ? value.toString("utf8") : value).trim();
    if (!text) return null;
    try {
      return JSON.parse(text.split("\n").filter(Boolean).at(-1) ?? text) as DockerStatsJson;
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && !Array.isArray(value) && !isReadable(value)) {
    return value as DockerStatsJson;
  }
  return null;
}

function isReadable(value: unknown): value is NodeJS.ReadableStream & { destroy?: () => void } {
  return Boolean(value && typeof value === "object" && typeof (value as NodeJS.ReadableStream).on === "function");
}

function createStatsParser(onStats: (stats: DockerStatsJson) => void) {
  let buffer = "";
  return (chunk: unknown) => {
    const direct = asStatsJson(chunk);
    if (direct?.cpu_stats || direct?.memory_stats || direct?.read) {
      onStats(direct);
      return;
    }
    const text = Buffer.isBuffer(chunk)
      ? chunk.toString("utf8")
      : typeof chunk === "string"
        ? chunk
        : "";
    if (!text) return;
    buffer += text.replace(/\r\n/g, "\n");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        try {
          onStats(JSON.parse(line) as DockerStatsJson);
        } catch {
          buffer = `${line}\n${buffer}`;
          break;
        }
      }
      newline = buffer.indexOf("\n");
    }
    const trimmed = buffer.trim();
    if (trimmed.startsWith("{")) {
      try {
        onStats(JSON.parse(trimmed) as DockerStatsJson);
        buffer = "";
      } catch {
        /* incomplete JSON — wait for the next chunk */
      }
    }
    if (buffer.length > 1_000_000) buffer = buffer.slice(-256_000);
  };
}

function cpuPercentFrom(stats: DockerStatsJson) {
  const current = stats.cpu_stats;
  const previous = stats.precpu_stats;
  const cpuDelta = (current?.cpu_usage?.total_usage ?? 0) - (previous?.cpu_usage?.total_usage ?? 0);
  const systemDelta = (current?.system_cpu_usage ?? 0) - (previous?.system_cpu_usage ?? 0);
  const online =
    current?.online_cpus ||
    current?.cpu_usage?.percpu_usage?.length ||
    previous?.cpu_usage?.percpu_usage?.length ||
    1;
  if (systemDelta > 0 && cpuDelta >= 0) {
    return (cpuDelta / systemDelta) * online * 100;
  }
  const read = Date.parse(stats.read ?? "");
  const preread = Date.parse(stats.preread ?? "");
  const ns = Number.isFinite(read) && Number.isFinite(preread) ? (read - preread) * 1e6 : 0;
  const poss = (ns / 100) * (stats.num_procs || online || 1);
  if (poss > 0 && cpuDelta >= 0) return (cpuDelta / poss) * 100;
  return 0;
}

function memoryUsedFrom(stats: DockerStatsJson) {
  const windows = stats.memory_stats?.privateworkingset;
  if (typeof windows === "number" && windows > 0) return windows;
  const extra = stats.memory_stats?.stats ?? {};
  const usage = stats.memory_stats?.usage ?? extra.anon ?? 0;
  const cache = extra.inactive_file ?? extra.total_inactive_file ?? extra.cache ?? extra.total_cache ?? 0;
  return Math.max(0, usage - (typeof cache === "number" ? cache : 0));
}

function netBytesFrom(stats: DockerStatsJson) {
  let rxBytes = 0;
  let txBytes = 0;
  for (const network of Object.values(stats.networks ?? {})) {
    rxBytes += network.rx_bytes ?? 0;
    txBytes += network.tx_bytes ?? 0;
  }
  return { rxBytes, txBytes };
}

function parseContainerStats(stats: DockerStatsJson): ContainerStats {
  const limit = stats.memory_stats?.limit ?? 0;
  const net = netBytesFrom(stats);
  return {
    cpuPercent: Math.max(0, Math.round(cpuPercentFrom(stats) * 10) / 10),
    memoryBytes: memoryUsedFrom(stats),
    memoryLimitBytes: limit > 0 && limit < 1e15 ? limit : null,
    rxBytes: net.rxBytes,
    txBytes: net.txBytes,
  };
}

function cacheStats(uuid: string, running: boolean, stats: ContainerStats | null) {
  const current = resourceCache.get(uuid);
  resourceCache.set(uuid, {
    at: Date.now(),
    running,
    stats,
    diskBytes: current?.diskBytes ?? 0,
    diskAt: current?.diskAt ?? 0,
  });
}

async function readFirstStatsJson(stream: NodeJS.ReadableStream & { destroy?: () => void }) {
  return new Promise<DockerStatsJson | null>((resolve) => {
    let previous: DockerStatsJson | null = null;
    let settled = false;
    const finish = (value: DockerStatsJson | null) => {
      if (settled) return;
      settled = true;
      stream.removeAllListeners();
      stream.destroy?.();
      resolve(value);
    };
    const timer = setTimeout(() => finish(previous), 2_500);
    const onStats = createStatsParser((parsed) => {
      if (!previous) {
        previous = parsed;
        return;
      }
      if (!parsed.precpu_stats?.cpu_usage?.total_usage && previous.cpu_stats) {
        parsed.precpu_stats = previous.cpu_stats;
        parsed.preread = previous.read;
      }
      clearTimeout(timer);
      finish(parsed);
    });
    stream.on("data", onStats);
    stream.on("end", () => finish(previous));
    stream.on("error", () => finish(previous));
  });
}

async function readDockerStats(uuid: string): Promise<ContainerStats | null> {
  const info = await inspectContainer(uuid);
  if (!info?.State.Running) return null;
  const container = docker.getContainer(info.Id);
  try {
    const raw: unknown = await container.stats({ stream: false });
    if (isReadable(raw)) {
      const parsed = await readFirstStatsJson(raw);
      return parsed ? parseContainerStats(parsed) : null;
    }
    const parsed = asStatsJson(raw);
    if (parsed) return parseContainerStats(parsed);
  } catch {
    /* one-shot failed; try a short stream */
  }
  const stream = (await container.stats({ stream: true })) as NodeJS.ReadableStream & { destroy?: () => void };
  const parsed = await readFirstStatsJson(stream);
  return parsed ? parseContainerStats(parsed) : null;
}

export async function liveResources(config: DaemonConfig, uuid: string) {
  const now = Date.now();
  const cached = resourceCache.get(uuid);
  const info = await inspectContainer(uuid);
  const running = Boolean(info?.State.Running);
  const startedAt = running && info?.State.StartedAt ? info.State.StartedAt : null;

  if (running) await ensureStatsStream(uuid).catch(() => undefined);
  else stopStatsStream(uuid);

  let stats = resourceCache.get(uuid)?.stats ?? null;
  if (running && !stats) {
    stats = await readDockerStats(uuid).catch(() => null);
    if (stats) cacheStats(uuid, true, stats);
  }

  if (!cached || now - cached.diskAt > 8_000) {
    void diskUsageBytes(serverRoot(config, uuid))
      .then((diskBytes) => {
        const current = resourceCache.get(uuid);
        resourceCache.set(uuid, {
          at: current?.at ?? Date.now(),
          running,
          stats: current?.stats ?? stats,
          diskBytes,
          diskAt: Date.now(),
        });
      })
      .catch(() => undefined);
  }

  return {
    running,
    stats,
    diskBytes: resourceCache.get(uuid)?.diskBytes ?? cached?.diskBytes ?? 0,
    startedAt,
  };
}

const statsStreams = new Map<string, { destroy: () => void; previous: DockerStatsJson | null }>();

export function stopStatsStream(uuid: string) {
  const current = statsStreams.get(uuid);
  if (!current) return;
  current.destroy();
  statsStreams.delete(uuid);
}

export async function ensureStatsStream(uuid: string) {
  if (statsStreams.has(uuid)) return;
  const info = await inspectContainer(uuid);
  if (!info?.State.Running) return;
  const stream = (await docker.getContainer(info.Id).stats({ stream: true })) as NodeJS.ReadableStream & {
    destroy?: () => void;
  };
  const entry: { destroy: () => void; previous: DockerStatsJson | null } = {
    previous: null,
    destroy: () => {
      stream.removeAllListeners();
      stream.destroy?.();
    },
  };
  statsStreams.set(uuid, entry);
  const onStats = createStatsParser((parsed) => {
    if (entry.previous && !parsed.precpu_stats?.cpu_usage?.total_usage && entry.previous.cpu_stats) {
      parsed.precpu_stats = entry.previous.cpu_stats;
      parsed.preread = entry.previous.read;
    }
    cacheStats(uuid, true, parseContainerStats(parsed));
    entry.previous = parsed;
  });
  stream.on("data", onStats);
  const stop = () => stopStatsStream(uuid);
  stream.on("end", stop);
  stream.on("error", stop);
}

export async function containerStats(uuid: string) {
  const cached = resourceCache.get(uuid);
  if (cached?.stats && Date.now() - cached.at < 750) return cached.stats;
  return readDockerStats(uuid).catch(() => null);
}

export async function diskUsageBytes(root: string): Promise<number> {
  async function walk(dir: string): Promise<number> {
    let total = 0;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return 0;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        total += await walk(full);
      } else if (entry.isFile()) {
        try {
          total += (await stat(full)).size;
        } catch {
          /* ignore */
        }
      }
    }
    return total;
  }
  return walk(root);
}

function decodeDockerFrames(buffer: Buffer) {
  if (buffer.length < 8 || buffer[0] > 2 || buffer[1] !== 0 || buffer[2] !== 0 || buffer[3] !== 0) {
    return { text: buffer.toString("utf8"), rest: Buffer.alloc(0) };
  }
  const parts: string[] = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset + 4);
    const end = offset + 8 + size;
    if (end > buffer.length) break;
    parts.push(buffer.subarray(offset + 8, end).toString("utf8"));
    offset = end;
  }
  return { text: parts.join(""), rest: buffer.subarray(offset) };
}

function decodeDockerLogs(buffer: Buffer) {
  return decodeDockerFrames(buffer).text;
}

function createOutputParser(tty: boolean, onLine: (line: string) => void) {
  let leftover: Buffer = Buffer.alloc(0);
  let text = "";
  const flushLine = (line: string) => {
    const formatted = formatDockerLogLine(line);
    if (formatted) onLine(formatted);
  };
  return {
    push(chunk: Buffer | string) {
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const buf = leftover.length ? Buffer.concat([leftover, incoming]) : incoming;
      const decoded = tty ? { text: buf.toString("utf8"), rest: Buffer.alloc(0) } : decodeDockerFrames(buf);
      leftover = decoded.rest;
      text += decoded.text;
      const parts = collapseConsoleBuffer(text);
      text = parts.rest;
      for (const line of parts.lines) flushLine(line);
    },
    end() {
      if (leftover.length) {
        const decoded = tty
          ? { text: leftover.toString("utf8"), rest: Buffer.alloc(0) }
          : decodeDockerFrames(leftover);
        leftover = Buffer.alloc(0);
        text += decoded.text;
      }
      const leftoverLine = visibleConsoleLine(sanitizeConsoleOutput(text)).trim();
      text = "";
      if (leftoverLine && !isProgressJunk(leftoverLine)) flushLine(leftoverLine);
    },
  };
}

async function asBuffer(value: Buffer | NodeJS.ReadableStream) {
  if (Buffer.isBuffer(value)) return value;
  const chunks: Buffer[] = [];
  for await (const chunk of value) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function getLogs(uuid: string, tail = 200, since?: number) {
  const info = await inspectContainer(uuid, true);
  if (!info) return { running: false, lines: [] as string[] };
  const raw = await docker.getContainer(info.Id).logs({
    stdout: true,
    stderr: true,
    timestamps: true,
    tail,
    ...(since ? { since } : {}),
  });
  const text = decodeDockerLogs(await asBuffer(raw as Buffer)).replace(/\r\n/g, "\n");
  const lines = text
    .split("\n")
    .map((line) => formatDockerLogLine(line))
    .filter((line) => line.length > 0);
  return { running: Boolean(info.State.Running), lines };
}

export async function followLogs(
  uuid: string,
  onChunk: (line: string) => void,
  signal: AbortSignal,
  options: { tail?: number; since?: number } = {},
): Promise<void> {
  const info = await inspectContainer(uuid, true);
  if (!info) return;
  if (!info.State.Running) return;
  const stream = (await docker.getContainer(info.Id).logs({
    follow: true,
    stdout: true,
    stderr: true,
    timestamps: true,
    tail: options.tail ?? 80,
    ...(options.since ? { since: options.since } : {}),
  })) as NodeJS.ReadableStream & { destroy?: () => void };
  const parser = createOutputParser(Boolean(info.Config.Tty), onChunk);

  await new Promise<void>((resolve) => {
    const onData = (chunk: Buffer | string) => parser.push(chunk);
    const stop = () => {
      stream.off("data", onData);
      parser.end();
      stream.destroy?.();
      resolve();
    };
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener("abort", stop, { once: true });
    stream.on("data", onData);
    stream.on("end", stop);
    stream.on("error", stop);
    stream.resume?.();
  });
}

let tryConsoleWrite: ((uuid: string, command: string) => boolean) | null = null;

export function setConsoleWriter(write: (uuid: string, command: string) => boolean) {
  tryConsoleWrite = write;
}

export async function attachStdin(uuid: string) {
  return attachStream(uuid, { stdin: true, stdout: true, stderr: true });
}

export async function attachConsole(
  uuid: string,
  onLine: (line: string) => void,
  signal: AbortSignal,
  onReady?: (write: (command: string) => boolean) => void,
): Promise<void> {
  const info = await inspectContainer(uuid);
  if (!info?.State.Running) throw new Error("Server is not running");
  const stream = await attachStream(uuid, { stdin: true, stdout: true, stderr: true });
  const parser = createOutputParser(Boolean(info.Config.Tty), onLine);
  const write = (command: string) => writeAttach(stream, command);
  onReady?.(write);

  await new Promise<void>((resolve) => {
    const stop = () => {
      stream.off("data", onData);
      parser.end();
      stream.destroy?.();
      resolve();
    };
    const onData = (chunk: Buffer | string) => parser.push(chunk);
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener("abort", stop, { once: true });
    stream.on("data", onData);
    stream.on("end", stop);
    stream.on("error", stop);
    stream.resume?.();
  });
}

function stdinBytes(command: string) {
  if (command === "\x03") return Buffer.from("\x03");
  const text = command.endsWith("\n") ? command : `${command}\n`;
  return Buffer.from(text, "utf8");
}

function writeAttach(stream: NodeJS.WritableStream, command: string) {
  try {
    stream.write(stdinBytes(command));
    return true;
  } catch {
    return false;
  }
}

async function attachStream(
  uuid: string,
  streams: { stdin: boolean; stdout: boolean; stderr: boolean },
) {
  const info = await inspectContainer(uuid);
  if (!info?.State.Running) throw new Error("Server is not running");
  const container = docker.getContainer(info.Id);
  try {
    const stream = await container.attach({
      stream: true,
      stdin: streams.stdin,
      stdout: streams.stdout,
      stderr: streams.stderr,
      hijack: true,
      logs: false,
    });
    return stream as NodeJS.ReadWriteStream & { destroy?: () => void };
  } catch {
    const id = encodeURIComponent(info.Id);
    const stdin = streams.stdin ? 1 : 0;
    const stdout = streams.stdout ? 1 : 0;
    const stderr = streams.stderr ? 1 : 0;
    return new Promise<NodeJS.ReadWriteStream & { destroy?: () => void }>((resolve, reject) => {
      docker.modem.dial(
        {
          path: `/containers/${id}/attach?stream=1&stdin=${stdin}&stdout=${stdout}&stderr=${stderr}&logs=0`,
          method: "POST",
          isStream: true,
          hijack: true,
          openStdin: streams.stdin,
          statusCodes: {
            200: true,
            404: "no such container",
            500: "server error",
          },
        },
        (error: Error | null, stream?: unknown) => {
          if (error || !stream) reject(error ?? new Error("Attach failed"));
          else resolve(stream as NodeJS.ReadWriteStream & { destroy?: () => void });
        },
      );
    });
  }
}

export async function injectContainerLog(uuid: string, message: string) {
  const info = await inspectContainer(uuid);
  if (!info?.State.Running) return false;
  const payload = message.replace(/'/g, `'\\''`);
  try {
    const exec = await docker.getContainer(info.Id).exec({
      AttachStdin: false,
      AttachStdout: false,
      AttachStderr: false,
      Tty: false,
      Cmd: ["sh", "-c", `printf '%s\\n' '${payload}' >/proc/1/fd/1`],
    });
    await exec.start({ Detach: true });
    return true;
  } catch {
    return false;
  }
}

export async function sendCommand(uuid: string, command: string) {
  const payload = command.endsWith("\n") || command === "\x03" ? command : `${command}\n`;
  if (tryConsoleWrite?.(uuid, payload)) return { ok: true };
  const stream = await withTimeout(attachStream(uuid, { stdin: true, stdout: true, stderr: true }), 2_000);
  try {
    if (!writeAttach(stream, payload)) throw new Error("stdin write failed");
    await new Promise((resolveWrite) => setTimeout(resolveWrite, 80));
  } finally {
    stream.destroy?.();
  }
  return { ok: true };
}

export async function runBackupContainer(image: string, binds: string[], cmd: string[]) {
  await pullImage(image);
  const container = await docker.createContainer({
    Image: image,
    Cmd: cmd,
    HostConfig: { Binds: binds, AutoRemove: false },
    Labels: { "flutter.role": "backup" },
  });
  try {
    await container.start();
    const result = await container.wait();
    if (result.StatusCode !== 0) {
      throw new Error(`Backup helper exited ${result.StatusCode}`);
    }
  } finally {
    await container.remove({ force: true }).catch(() => undefined);
  }
}
