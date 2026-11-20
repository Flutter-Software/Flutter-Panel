import { z } from "zod";
import { FlutterError } from "./errors";

export const DEFAULT_TELEMETRY_URL = "https://telemetry.flutter.software/v1/events";
export const DEFAULT_TELEMETRY_INGEST_KEY = "flutter-panel-telemetry-v1";
export const TELEMETRY_INGEST_HEADER = "x-flutter-telemetry-key";

export const TELEMETRY_EVENT_TYPES = ["heartbeat", "download", "error"] as const;
export type TelemetryEventType = (typeof TELEMETRY_EVENT_TYPES)[number];

export const telemetryEventTypeSchema = z.enum(TELEMETRY_EVENT_TYPES);

export const telemetryHeartbeatPropsSchema = z.object({
  version: z.string().max(32),
  servers: z.number().int().nonnegative(),
  nodes: z.number().int().nonnegative(),
  nodesOnline: z.number().int().nonnegative(),
  users: z.number().int().nonnegative(),
  eggs: z.number().int().nonnegative(),
  smtp: z.boolean(),
  oidc: z.boolean(),
  redis: z.boolean(),
  registrationOpen: z.boolean(),
  os: z.string().max(32),
  arch: z.string().max(16),
  runtime: z.string().max(32).optional(),
  telemetryEnabled: z.boolean(),
});

export const telemetryDownloadPropsSchema = z.object({
  outcome: z.enum(["success", "fail"]),
  kind: z.enum(["file", "zip"]),
  sizeBucket: z.string().max(16).optional(),
  itemCountBucket: z.string().max(8),
  durationMs: z.number().int().nonnegative().max(3_600_000),
  failReason: z.string().max(32).optional(),
  message: z.string().max(500).optional(),
});

export const TELEMETRY_MESSAGE_MAX = 4_000;
export const TELEMETRY_STACK_MAX = 12_000;
export const TELEMETRY_CAUSE_MAX = 4_000;
export const TELEMETRY_DETAILS_MAX = 4_000;
export const TELEMETRY_CONTEXT_MAX = 4_000;

export const telemetryErrorPropsSchema = z.object({
  // "daemon" errors happen on a node (SFTP, ...) and are relayed by the panel.
  source: z.enum(["api", "web", "process", "log", "daemon"]),
  kind: z.string().max(32).optional(),
  code: z.string().max(32).optional(),
  name: z.string().max(80).optional(),
  message: z.string().max(TELEMETRY_MESSAGE_MAX).optional(),
  status: z.number().int().min(100).max(599).optional(),
  route: z.string().max(200).optional(),
  method: z.string().max(16).optional(),
  requestId: z.string().max(64).optional(),
  digest: z.string().max(64).optional(),
  stack: z.string().max(TELEMETRY_STACK_MAX).optional(),
  cause: z.string().max(TELEMETRY_CAUSE_MAX).optional(),
  details: z.string().max(TELEMETRY_DETAILS_MAX).optional(),
  context: z.string().max(TELEMETRY_CONTEXT_MAX).optional(),
  version: z.string().max(32).optional(),
  runtime: z.string().max(32).optional(),
  userAgent: z.string().max(200).optional(),
});

export const telemetryEventSchema = z.object({
  type: telemetryEventTypeSchema,
  ts: z.string().min(1).max(40).optional(),
  props: z.record(z.unknown()),
});

export const telemetryBatchSchema = z.object({
  installId: z.string().uuid(),
  events: z.array(telemetryEventSchema).min(1).max(50),
});

export const telemetryUpdateSchema = z.object({
  enabled: z.boolean(),
});

export const telemetryClientErrorSchema = z.object({
  name: z.string().trim().max(80).optional(),
  message: z.string().trim().max(TELEMETRY_MESSAGE_MAX).optional(),
  digest: z.string().trim().max(64).optional(),
  route: z.string().trim().max(200).optional(),
  stack: z.string().max(TELEMETRY_STACK_MAX).optional(),
  cause: z.string().max(TELEMETRY_CAUSE_MAX).optional(),
  kind: z.enum(["boundary", "window", "rejection"]).optional(),
  userAgent: z.string().trim().max(200).optional(),
});

/** Most error reports a daemon may send to the panel in one request. */
export const DAEMON_ERROR_BATCH_MAX = 20;
export const DAEMON_ERROR_MESSAGE_MAX = 1_000;

/**
 * One error a daemon observed on its node.
 *
 * The daemon has no telemetry connection of its own: it posts these to the
 * panel (`POST /api/v1/daemon/errors`), which forwards them as telemetry
 * `error` events with `source: "daemon"` if the admin has telemetry on.
 *
 * Reports must already be free of file paths, usernames and server ids; the
 * daemon scrubs them before sending and the panel redacts again.
 */
export const daemonErrorReportSchema = z.object({
  /** Subsystem the error came from, e.g. "sftp". */
  kind: z.string().trim().min(1).max(32),
  /** Operation that failed, e.g. "WRITE" or "RENAME". */
  op: z.string().trim().min(1).max(32),
  /** Errno-style code, e.g. "ENOSPC", or "UNKNOWN". */
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().max(80).optional(),
  message: z.string().trim().max(DAEMON_ERROR_MESSAGE_MAX),
  /** Only sent for unexpected (non-filesystem) errors. */
  stack: z.string().max(TELEMETRY_STACK_MAX).optional(),
  /** How many times this happened since the previous report of the same error. */
  count: z.number().int().min(1).max(1_000_000).optional(),
  /** `process.platform` of the node. */
  platform: z.string().trim().max(32).optional(),
  /** Daemon version. */
  version: z.string().trim().max(32).optional(),
  /** ISO time of the most recent occurrence. */
  ts: z.string().min(1).max(40).optional(),
});

export const daemonErrorBatchSchema = z.object({
  nodeId: z.string().min(1).max(64),
  errors: z.array(daemonErrorReportSchema).min(1).max(DAEMON_ERROR_BATCH_MAX),
});

export type DaemonErrorReport = z.infer<typeof daemonErrorReportSchema>;
export type DaemonErrorBatch = z.infer<typeof daemonErrorBatchSchema>;

export type TelemetryHeartbeatProps = z.infer<typeof telemetryHeartbeatPropsSchema>;
export type TelemetryDownloadProps = z.infer<typeof telemetryDownloadPropsSchema>;
export type TelemetryErrorProps = z.infer<typeof telemetryErrorPropsSchema>;
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;
export type TelemetryBatch = z.infer<typeof telemetryBatchSchema>;

const PROPS_BY_TYPE = {
  heartbeat: telemetryHeartbeatPropsSchema,
  download: telemetryDownloadPropsSchema,
  error: telemetryErrorPropsSchema,
} as const;

export function parseTelemetryProps(type: TelemetryEventType, props: unknown) {
  return PROPS_BY_TYPE[type].safeParse(props);
}

export function sizeBucket(bytes: number) {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return "<1MB";
  if (mb < 10) return "1-10MB";
  if (mb < 50) return "10-50MB";
  if (mb <= 250) return "50-250MB";
  return "over_cap";
}

export function itemCountBucket(count: number) {
  if (count <= 1) return "1";
  if (count <= 10) return "2-10";
  return "11+";
}

export function routeTemplate(path: string) {
  return path
    .split("?")[0]
    .replace(/\/[a-f0-9]{24}(?=\/|$)/gi, "/:id")
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi,
      "/:uuid",
    )
    .replace(/\/[A-Za-z0-9_-]{22,}(?=\/|$)/g, "/:token")
    .slice(0, 200);
}

export function redactTelemetryText(value: string | undefined | null, max = TELEMETRY_STACK_MAX) {
  if (typeof value !== "string" || !value) return undefined;
  const cleaned = value
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<private-key>")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email>")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@[^\s"'<>]+/gi, "<uri>")
    .replace(/\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mariadb|redis|amqp|smtps?):\/\/[^\s"'<>]+/gi, "<uri>")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "<jwt>")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "<aws-key>")
    .replace(/bearer\s+[a-z0-9._~+/=-]{8,}/gi, "bearer <redacted>")
    .replace(/([?&](?:code|state|access_token|refresh_token|id_token|client_secret)=)[^&\s#]+/gi, "$1<redacted>")
    .replace(
      /(password|passwd|secret|token|api[_-]?key|authorization|cookie|session|client[_-]?secret)(\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s"',}&]+)/gi,
      "$1$2<redacted>",
    );
  const text = cleaned.slice(0, max).trim();
  return text || undefined;
}

export function telemetryErrorText(error: unknown) {
  if (error instanceof Error) return error.message || error.name || "Error";
  if (typeof error === "string") return error;
  if (error == null) return "Unknown error";
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

export function serializeErrorDetails(details: unknown, max = TELEMETRY_DETAILS_MAX) {
  if (details == null) return undefined;
  if (typeof details === "string") return redactTelemetryText(details, max);
  try {
    return redactTelemetryText(JSON.stringify(details), max);
  } catch {
    return undefined;
  }
}

export function formatErrorCause(error: unknown, max = TELEMETRY_CAUSE_MAX) {
  if (!(error instanceof Error) || error.cause == null) return undefined;
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error.cause;
  while (current != null && parts.length < 6) {
    if (seen.has(current)) break;
    seen.add(current);
    if (current instanceof Error) {
      const stack = current.stack ? `\n${current.stack}` : "";
      parts.push(`${current.name}: ${current.message}${stack}`);
      current = current.cause;
      continue;
    }
    if (typeof current === "string") parts.push(current);
    else {
      try {
        parts.push(JSON.stringify(current));
      } catch {
        parts.push("unserializable cause");
      }
    }
    break;
  }
  if (!parts.length) return undefined;
  return redactTelemetryText(parts.join("\nCaused by: "), max);
}

export function sanitizeStack(stack: string | undefined, max = TELEMETRY_STACK_MAX) {
  return redactTelemetryText(stack, max);
}

export function downloadFailReason(error: unknown) {
  const code = error instanceof FlutterError ? error.code : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (code === "FORBIDDEN" || message.includes(".flutter")) return "forbidden";
  if (code === "NOT_FOUND") return "not_found";
  if (message.includes("larger than") || message.includes("too many files")) return "too_large";
  if (message.includes("not found") || message.includes("nothing to download")) return "not_found";
  if (message.includes("timeout") || message.includes("aborted") || message.includes("timed out")) {
    return "timeout";
  }
  if (code === "UNAVAILABLE" || message.includes("offline") || message.includes("unreachable")) {
    return "node_offline";
  }
  return "failed";
}

const SKIP_ERROR_CODES = new Set(["VALIDATION", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT"]);

export function shouldReportApiError(error: unknown) {
  if (error instanceof FlutterError) return !SKIP_ERROR_CODES.has(error.code);
  return true;
}
