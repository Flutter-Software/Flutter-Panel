import { randomUUID } from "node:crypto";
import {
  DEFAULT_TELEMETRY_INGEST_KEY,
  DEFAULT_TELEMETRY_URL,
  FlutterError,
  PANEL_VERSION,
  TELEMETRY_INGEST_HEADER,
  downloadFailReason,
  formatErrorCause,
  itemCountBucket,
  redactTelemetryText,
  routeTemplate,
  sanitizeStack,
  serializeErrorDetails,
  shouldReportApiError,
  sizeBucket,
  TELEMETRY_CAUSE_MAX,
  TELEMETRY_CONTEXT_MAX,
  TELEMETRY_MESSAGE_MAX,
  TELEMETRY_STACK_MAX,
  telemetryBatchSchema,
  telemetryClientErrorSchema,
  telemetryErrorText,
  type TelemetryDownloadProps,
  type TelemetryErrorProps,
  type TelemetryEvent,
  type TelemetryHeartbeatProps,
} from "@flutter-software/shared";
import { Egg, Node, PanelSettings, Server, User } from "./db/models";
import { env } from "./env";
import { log } from "./log";
import { isNodeOnline } from "./nodes";
import { pingRedis } from "./redis";

const FLUSH_MS = 60_000;
const ERROR_FLUSH_MS = 2_000;
const FLUSH_AT = 20;
const MAX_QUEUE = 200;
const HEARTBEAT_MS = 24 * 60 * 60 * 1000;
const HEARTBEAT_START_DELAY_MS = 15_000;
const CLIENT_ERROR_MAX_PER_MIN = 60;
const SETTINGS_KEY = "panel";
const SECRET_KEY = /password|passwd|secret|token|authorization|cookie|session|credential|smtp.?pass/i;

type Queued = TelemetryEvent;

let queue: Queued[] = [];
let flushTimer: ReturnType<typeof setInterval> | undefined;
let errorFlushTimer: ReturnType<typeof setTimeout> | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let heartbeatStartTimer: ReturnType<typeof setTimeout> | undefined;
let flushing = false;
let processHooks = false;
let crashing = false;
let capturingLog = false;
let clientErrorWindow = { started: 0, count: 0 };

function truthyFlag(value: string | undefined) {
  return value === "true" || value === "1";
}

export function telemetryEnvDisabled() {
  return truthyFlag(process.env.TELEMETRY_DISABLED);
}

function ingestUrl() {
  const fromEnv = env().TELEMETRY_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  if (env().NODE_ENV === "production") return DEFAULT_TELEMETRY_URL;
  return "";
}

function ingestKey() {
  return env().TELEMETRY_INGEST_KEY || DEFAULT_TELEMETRY_INGEST_KEY;
}

export function telemetrySendingConfigured() {
  return Boolean(ingestUrl()) && !telemetryEnvDisabled();
}

async function loadSettings() {
  let row = await PanelSettings.findOne({ key: SETTINGS_KEY });
  if (!row) {
    row = await PanelSettings.create({ key: SETTINGS_KEY });
  }
  return row;
}

function enabledOf(row: { telemetryEnabled?: boolean | null } | null | undefined) {
  return row?.telemetryEnabled !== false;
}

async function ensureInstallId(row: Awaited<ReturnType<typeof loadSettings>>) {
  const current = typeof row.telemetryInstallId === "string" ? row.telemetryInstallId.trim() : "";
  if (current) return current;
  row.telemetryInstallId = randomUUID();
  await row.save();
  return String(row.telemetryInstallId);
}

export async function anonymousTelemetryActive() {
  if (telemetryEnvDisabled() || !ingestUrl()) return false;
  const row = await PanelSettings.findOne({ key: SETTINGS_KEY }).select("telemetryEnabled").lean();
  if (!row || Array.isArray(row)) return true;
  return row.telemetryEnabled !== false;
}

export async function getTelemetryPublic() {
  const row = await loadSettings();
  const installId = await ensureInstallId(row);
  const enabled = enabledOf(row);
  const envDisabled = telemetryEnvDisabled();
  return {
    enabled,
    envDisabled,
    installId,
    sending: enabled && !envDisabled && Boolean(ingestUrl()),
  };
}

function definedProps(props: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out;
}

function enqueue(event: Queued) {
  queue.push(event);
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  if (queue.length >= FLUSH_AT) void flush();
  if (event.type !== "error" || errorFlushTimer) return;
  errorFlushTimer = setTimeout(() => {
    errorFlushTimer = undefined;
    void flush();
  }, ERROR_FLUSH_MS);
  if (typeof errorFlushTimer.unref === "function") errorFlushTimer.unref();
}

export function track(type: TelemetryEvent["type"], props: Record<string, unknown>) {
  if (telemetryEnvDisabled()) return;
  enqueue({
    type,
    ts: new Date().toISOString(),
    props: definedProps(props),
  });
}

function runtimeLabel() {
  return process.version.slice(0, 32);
}

function clip(value: unknown, max: number) {
  if (typeof value !== "string") return undefined;
  const text = value.slice(0, max).trim();
  return text || undefined;
}

function systemCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") return undefined;
  return code.trim().slice(0, 32) || undefined;
}

function describeError(error: unknown) {
  if (error instanceof FlutterError) {
    return { code: error.code, name: "FlutterError", status: error.status };
  }
  if (error instanceof Error) {
    return {
      code: systemCode(error) || "INTERNAL",
      name: (error.name || "Error").slice(0, 80),
      status: 500,
    };
  }
  return { code: "INTERNAL", name: "Error", status: 500 };
}

function contextText(extra: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (SECRET_KEY.test(key) || value == null) continue;
    if (typeof value === "string") {
      const text = redactTelemetryText(value, 500);
      if (text) out[key] = text;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (value instanceof Error) {
      const text = redactTelemetryText(value.message, 500);
      if (text) out[key] = text;
    } else {
      try {
        const text = redactTelemetryText(JSON.stringify(value), 800);
        if (!text) continue;
        out[key] = JSON.parse(text) as unknown;
      } catch {
        const text = serializeErrorDetails(value, 500);
        if (text) out[key] = text;
      }
    }
  }
  if (!Object.keys(out).length) return undefined;
  try {
    return redactTelemetryText(JSON.stringify(out), TELEMETRY_CONTEXT_MAX);
  } catch {
    return undefined;
  }
}

export function trackDownload(input: {
  outcome: "success" | "fail";
  kind: "file" | "zip";
  bytes?: number;
  itemCount: number;
  durationMs: number;
  error?: unknown;
}) {
  const props: TelemetryDownloadProps = {
    outcome: input.outcome,
    kind: input.kind,
    itemCountBucket: itemCountBucket(input.itemCount),
    durationMs: Math.min(Math.max(0, Math.round(input.durationMs)), 3_600_000),
  };
  if (typeof input.bytes === "number" && Number.isFinite(input.bytes)) {
    props.sizeBucket = sizeBucket(input.bytes);
  }
  if (input.outcome === "fail") {
    props.failReason = downloadFailReason(input.error);
    props.message = redactTelemetryText(telemetryErrorText(input.error), 500);
    if (props.failReason === "too_large") props.sizeBucket = "over_cap";
  }
  track("download", props);
}

function skipErrorRoute(route: string) {
  return (
    route.endsWith("/health") ||
    route.includes("/telemetry") ||
    route.includes("/files/download")
  );
}

export function trackApiError(
  error: unknown,
  routeRaw: string,
  meta?: { method?: string; requestId?: string },
) {
  const route = routeTemplate(routeRaw || "");
  if (skipErrorRoute(route) || skipErrorRoute(routeRaw)) return;
  if (!shouldReportApiError(error)) return;
  const described = describeError(error);
  const props: TelemetryErrorProps = {
    source: "api",
    kind: "request",
    code: described.code,
    name: described.name,
    status: described.status,
    message: redactTelemetryText(telemetryErrorText(error), TELEMETRY_MESSAGE_MAX),
    stack: sanitizeStack(error instanceof Error ? error.stack : undefined),
    cause: formatErrorCause(error),
    details: error instanceof FlutterError ? serializeErrorDetails(error.details) : undefined,
    route: route || undefined,
    method: meta?.method?.slice(0, 16),
    requestId: meta?.requestId?.slice(0, 64),
    version: PANEL_VERSION,
    runtime: runtimeLabel(),
  };
  track("error", props);
}

export function trackLoggedError(
  message: string,
  extra: Record<string, unknown> = {},
  level: "error" | "warn" = "error",
) {
  if (capturingLog || telemetryEnvDisabled()) return;
  capturingLog = true;
  try {
    const errorValue = extra.error ?? extra.err;
    const stackValue = extra.stack ?? extra.errorStack ?? extra.errStack;
    const rest = { ...extra };
    delete rest.error;
    delete rest.err;
    delete rest.stack;
    delete rest.errorStack;
    delete rest.errStack;
    const fromError = errorValue instanceof Error ? errorValue : undefined;
    const parts = [message];
    if (fromError?.message) parts.push(fromError.message);
    else if (errorValue != null) parts.push(telemetryErrorText(errorValue));
    const described = fromError ? describeError(fromError) : { code: "LOG", name: "Log", status: 500 };
    const props: TelemetryErrorProps = {
      source: "log",
      kind: level,
      code: described.code,
      name: described.name,
      message: redactTelemetryText(parts.join(": "), TELEMETRY_MESSAGE_MAX),
      stack: sanitizeStack(fromError?.stack || (typeof stackValue === "string" ? stackValue : undefined)),
      cause: fromError ? formatErrorCause(fromError) : undefined,
      context: contextText(rest),
      version: PANEL_VERSION,
      runtime: runtimeLabel(),
    };
    track("error", props);
  } finally {
    capturingLog = false;
  }
}

export function trackProcessError(label: string, error: unknown) {
  const described = describeError(error);
  const props: TelemetryErrorProps = {
    source: "process",
    kind: label.slice(0, 32),
    code: described.code,
    name: described.name,
    message: redactTelemetryText(`${label}: ${telemetryErrorText(error)}`, TELEMETRY_MESSAGE_MAX),
    stack: sanitizeStack(error instanceof Error ? error.stack : undefined),
    cause: formatErrorCause(error),
    version: PANEL_VERSION,
    runtime: runtimeLabel(),
  };
  track("error", props);
}

function clientErrorAllowed() {
  const now = Date.now();
  if (now - clientErrorWindow.started > 60_000) {
    clientErrorWindow = { started: now, count: 0 };
  }
  if (clientErrorWindow.count >= CLIENT_ERROR_MAX_PER_MIN) return false;
  clientErrorWindow.count += 1;
  return true;
}

export function trackClientError(body: unknown, meta?: { userAgent?: string | null }) {
  if (!clientErrorAllowed()) return;
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const kind = raw.kind === "boundary" || raw.kind === "window" || raw.kind === "rejection" ? raw.kind : undefined;
  const parsed = telemetryClientErrorSchema.safeParse({
    name: clip(raw.name, 80),
    message: clip(raw.message, TELEMETRY_MESSAGE_MAX),
    digest: clip(raw.digest, 64),
    route: clip(raw.route, 200),
    stack: clip(raw.stack, TELEMETRY_STACK_MAX),
    cause: clip(raw.cause, TELEMETRY_CAUSE_MAX),
    kind,
    userAgent: clip(meta?.userAgent || raw.userAgent, 200),
  });
  const data = parsed.success ? parsed.data : {};
  const route = routeTemplate(data.route || "");
  const props: TelemetryErrorProps = {
    source: "web",
    kind: data.kind,
    name: (data.name || "Error").slice(0, 80),
    message: redactTelemetryText(data.message, TELEMETRY_MESSAGE_MAX),
    digest: data.digest,
    route: route || undefined,
    stack: sanitizeStack(data.stack),
    cause: redactTelemetryText(data.cause, TELEMETRY_CAUSE_MAX),
    userAgent: redactTelemetryText(data.userAgent, 200),
    version: PANEL_VERSION,
    runtime: runtimeLabel(),
  };
  track("error", props);
}

async function redisUp() {
  try {
    await pingRedis();
    return true;
  } catch {
    return false;
  }
}

async function heartbeatProps(enabled: boolean): Promise<TelemetryHeartbeatProps> {
  const [servers, nodes, users, eggs, row, redis] = await Promise.all([
    Server.countDocuments(),
    Node.find({}, { lastHeartbeatAt: 1 }).lean(),
    User.countDocuments(),
    Egg.countDocuments(),
    PanelSettings.findOne({ key: SETTINGS_KEY }),
    redisUp(),
  ]);
  const smtp = row?.smtp as { enabled?: boolean; host?: string } | undefined;
  const oidc = row?.oidc as {
    enabled?: boolean;
    issuer?: string;
    clientId?: string;
    passwordLogin?: boolean;
  } | undefined;
  const smtpOn = Boolean(smtp?.enabled && smtp.host?.trim()) || Boolean(env().SMTP_HOST);
  const oidcOn = Boolean(oidc?.enabled && oidc.issuer?.trim() && oidc.clientId?.trim()) || Boolean(env().OIDC_ISSUER);
  return {
    version: PANEL_VERSION,
    servers,
    nodes: nodes.length,
    nodesOnline: nodes.filter((node) => isNodeOnline(node.lastHeartbeatAt)).length,
    users,
    eggs,
    smtp: smtpOn,
    oidc: oidcOn,
    redis,
    registrationOpen: oidc?.passwordLogin !== false,
    os: process.platform.slice(0, 32),
    arch: process.arch.slice(0, 16),
    runtime: runtimeLabel(),
    telemetryEnabled: enabled,
  };
}

export async function sendHeartbeat(opts?: { enabled?: boolean; force?: boolean }) {
  try {
    if (telemetryEnvDisabled()) return;
    if (!ingestUrl()) return;
    const row = await loadSettings();
    const enabled = opts?.enabled ?? enabledOf(row);
    if (!enabled && !opts?.force) return;
    await ensureInstallId(row);
    track("heartbeat", await heartbeatProps(enabled));
    row.telemetryLastHeartbeatAt = new Date();
    await row.save();
    await flush();
  } catch (error) {
    log(
      "warn",
      "telemetry heartbeat failed",
      { error: error instanceof Error ? error.message : "unknown" },
      { telemetry: false },
    );
  }
}

export async function setTelemetryEnabled(enabled: boolean) {
  const row = await loadSettings();
  row.telemetryEnabled = enabled;
  await row.save();
  if (enabled) {
    await sendHeartbeat({ enabled: true });
  } else {
    await sendHeartbeat({ enabled: false, force: true });
    queue = queue.filter((event) => event.type === "heartbeat");
    await flush();
  }
}

async function flush() {
  if (flushing) return;
  if (telemetryEnvDisabled()) {
    queue = [];
    return;
  }
  const url = ingestUrl();
  if (!url) {
    queue = [];
    return;
  }
  let row: Awaited<ReturnType<typeof loadSettings>>;
  try {
    row = await loadSettings();
  } catch {
    return;
  }
  if (!enabledOf(row) && !queue.some((event) => event.type === "heartbeat")) {
    queue = [];
    return;
  }
  if (!queue.length) return;
  flushing = true;
  const batch = queue.splice(0, 20);
  let retry = false;
  try {
    const installId = await ensureInstallId(row);
    const parsed = telemetryBatchSchema.safeParse({ installId, events: batch });
    if (!parsed.success) {
      log("warn", "telemetry batch invalid", {}, { telemetry: false });
      return;
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        [TELEMETRY_INGEST_HEADER]: ingestKey(),
      },
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      log("warn", "telemetry ingest rejected", { status: response.status }, { telemetry: false });
      retry = response.status >= 500 || response.status === 429;
    }
  } catch (error) {
    retry = true;
    log(
      "warn",
      "telemetry flush failed",
      { error: error instanceof Error ? error.message : "unknown" },
      { telemetry: false },
    );
  } finally {
    if (retry) queue = [...batch, ...queue].slice(-MAX_QUEUE);
    flushing = false;
  }
}

function installProcessHooks() {
  if (processHooks || telemetryEnvDisabled() || !ingestUrl()) return;
  processHooks = true;
  process.on("uncaughtException", (error) => {
    if (crashing) return;
    crashing = true;
    log(
      "error",
      error instanceof Error ? error.message : "uncaught exception",
      { stack: error instanceof Error ? error.stack : undefined },
      { telemetry: false },
    );
    trackProcessError("uncaught exception", error);
    const force = setTimeout(() => process.exit(1), 2_000);
    void flush().finally(() => {
      clearTimeout(force);
      process.exit(1);
    });
  });
  process.on("unhandledRejection", (reason) => {
    log(
      "error",
      reason instanceof Error ? reason.message : "unhandled rejection",
      {
        name: reason instanceof Error ? reason.name : "UnhandledRejection",
        stack: reason instanceof Error ? reason.stack : undefined,
      },
      { telemetry: false },
    );
    trackProcessError("unhandled rejection", reason);
  });
}

export function startTelemetry() {
  if (flushTimer) return;
  installProcessHooks();
  flushTimer = setInterval(() => {
    void flush();
  }, FLUSH_MS);
  heartbeatTimer = setInterval(() => {
    void sendHeartbeat();
  }, HEARTBEAT_MS);
  heartbeatStartTimer = setTimeout(() => {
    void sendHeartbeat();
  }, HEARTBEAT_START_DELAY_MS);
  if (typeof flushTimer.unref === "function") flushTimer.unref();
  if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();
  if (typeof heartbeatStartTimer.unref === "function") heartbeatStartTimer.unref();
}

export async function stopTelemetry() {
  if (flushTimer) clearInterval(flushTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (heartbeatStartTimer) clearTimeout(heartbeatStartTimer);
  if (errorFlushTimer) clearTimeout(errorFlushTimer);
  flushTimer = undefined;
  heartbeatTimer = undefined;
  heartbeatStartTimer = undefined;
  errorFlushTimer = undefined;
  await flush();
}
