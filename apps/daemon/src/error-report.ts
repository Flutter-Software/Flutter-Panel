/**
 * Daemon error reporting.
 *
 * The daemon cannot reach the telemetry service itself (it has no install id
 * and does not know whether the admin opted out). Instead it posts errors to
 * the panel at `POST /api/v1/daemon/errors`; the panel decides whether to
 * forward them as telemetry `error` events with `source: "daemon"`.
 *
 *   reportDaemonError() ─▶ throttle ─▶ queue ─▶ flush (2 s later) ─▶ panel
 *
 * Privacy: reports are anonymous. `scrubErrorText` removes file paths and
 * server ids before anything is queued, so no file name, username or server
 * uuid leaves the node.
 *
 * Reporting is best effort. It never throws and never blocks the caller; if
 * the panel is unreachable the reports are dropped.
 */
import {
  DAEMON_ERROR_BATCH_MAX,
  DAEMON_ERROR_MESSAGE_MAX,
  type DaemonErrorReport,
} from "@flutter-software/shared";
import { DAEMON_VERSION, type DaemonConfig } from "./config";
import { panelUrlCandidates } from "./heartbeat";

/** The same error (kind + op + code) is reported at most once per window. */
const THROTTLE_MS = 60_000;
/** Delay before sending, so a burst of errors goes out as one request. */
const FLUSH_DELAY_MS = 2_000;
/** Reports kept while waiting to send. Oldest are dropped first. */
const MAX_QUEUE = 100;
/** Distinct error keys remembered for throttling. */
const MAX_THROTTLE_KEYS = 500;

type ThrottleState = {
  /** When this error was last queued for sending. */
  sentAt: number;
  /** Occurrences swallowed since then; added to the next report's `count`. */
  suppressed: number;
};

const throttle = new Map<string, ThrottleState>();
let queue: DaemonErrorReport[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushing = false;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Remove anything that could identify a user or server from error text.
 *
 * Node's filesystem errors embed full paths in quotes
 * (`EISDIR: illegal operation on a directory, open '/data/<uuid>/world'`), so
 * every quoted string becomes `<path>`. Unquoted absolute paths (POSIX and
 * Windows) and uuids are replaced as well.
 */
export function scrubErrorText(value: string | undefined, max = DAEMON_ERROR_MESSAGE_MAX): string {
  if (!value) return "";
  return value
    .replace(/'[^'\n]*'|"[^"\n]*"/g, "<path>")
    .replace(/\b[a-z]:\\[^\s:)]+/gi, "<path>")
    .replace(/(^|[\s(])\/[^\s:)]+/g, "$1<path>")
    .replace(UUID, "<uuid>")
    .slice(0, max)
    .trim();
}

/** Scrub a stack trace line by line, keeping function names and dropping paths. */
function scrubStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const text = stack
    .split("\n")
    .slice(0, 30)
    .map((line) => {
      // "    at fn (file:///opt/flutter/apps/daemon/src/sftp.ts:10:5)" -> keep "fn"
      // and the file's base name only.
      const frame = /^(\s*at\s+(?:async\s+)?[^\s(]+\s*)\((.*)\)\s*$/.exec(line);
      if (frame) {
        const base = (frame[2] ?? "").split(/[\\/]/).pop() ?? "";
        return `${frame[1]}(${base})`;
      }
      return scrubErrorText(line, 500);
    })
    .join("\n");
  return text || undefined;
}

export type DaemonErrorInput = {
  /** Subsystem, e.g. "sftp". */
  kind: string;
  /** Operation that failed, e.g. "WRITE". */
  op: string;
  /** Errno-style code, e.g. "ENOSPC". */
  code: string;
  /** Raw error message; scrubbed here. */
  message: string;
  name?: string;
  /** Raw stack; scrubbed here. Pass only for unexpected errors. */
  stack?: string;
};

/**
 * Queue one error for delivery to the panel.
 *
 * Repeats of the same `kind` + `op` + `code` inside `THROTTLE_MS` are counted
 * rather than sent; the count rides along on the next report. A count that is
 * never followed by another occurrence is dropped, which is acceptable for a
 * signal whose purpose is "this is happening", not exact totals.
 */
export function reportDaemonError(config: DaemonConfig, input: DaemonErrorInput): void {
  try {
    const key = `${input.kind}|${input.op}|${input.code}`;
    const now = Date.now();
    const state = throttle.get(key);
    if (state && now - state.sentAt < THROTTLE_MS) {
      state.suppressed += 1;
      return;
    }
    if (!state && throttle.size >= MAX_THROTTLE_KEYS) throttle.clear();
    throttle.set(key, { sentAt: now, suppressed: 0 });

    queue.push({
      kind: input.kind.slice(0, 32),
      op: input.op.slice(0, 32),
      code: input.code.slice(0, 32) || "UNKNOWN",
      name: input.name?.slice(0, 80) || undefined,
      message: scrubErrorText(input.message) || input.code,
      stack: scrubStack(input.stack),
      count: (state?.suppressed ?? 0) + 1,
      platform: process.platform.slice(0, 32),
      version: DAEMON_VERSION.slice(0, 32),
      ts: new Date(now).toISOString(),
    });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);

    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void flush(config);
    }, FLUSH_DELAY_MS);
    // Never keep the daemon alive just to send a report.
    if (typeof flushTimer.unref === "function") flushTimer.unref();
  } catch {
    /* reporting must never break the operation that failed */
  }
}

/** POST one batch to the first panel URL that accepts it. */
async function postBatch(config: DaemonConfig, errors: DaemonErrorReport[]): Promise<boolean> {
  for (const panelUrl of panelUrlCandidates(config)) {
    const url = `${panelUrl.replace(/\/+$/, "")}/api/v1/daemon/errors`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.daemonToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ nodeId: config.nodeId, errors }),
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) return true;
      // The panel answered but refused (old panel without this route, bad
      // token, rate limit). Another URL would give the same answer.
      if (response.status >= 400 && response.status < 500) return false;
    } catch {
      /* try the next candidate */
    }
  }
  return false;
}

/** Send everything queued, one batch at a time. Failures drop the batch. */
async function flush(config: DaemonConfig): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    while (queue.length) {
      const batch = queue.splice(0, DAEMON_ERROR_BATCH_MAX);
      if (!(await postBatch(config, batch))) {
        queue = [];
        return;
      }
    }
  } catch {
    queue = [];
  } finally {
    flushing = false;
  }
}
