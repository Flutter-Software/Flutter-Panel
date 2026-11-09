import {
  formatErrorCause,
  redactTelemetryText,
  routeTemplate,
  TELEMETRY_CAUSE_MAX,
  TELEMETRY_MESSAGE_MAX,
  TELEMETRY_STACK_MAX,
} from "@flutter-software/shared";

export type ClientErrorKind = "boundary" | "window" | "rejection";

type ClientErrorInput = {
  name?: string;
  message?: string;
  stack?: string;
  digest?: string;
  cause?: unknown;
};

const recent = new Map<string, number>();

function causeText(error: ClientErrorInput) {
  if (error instanceof Error) return formatErrorCause(error);
  if (typeof error.cause === "string") return redactTelemetryText(error.cause, TELEMETRY_CAUSE_MAX);
  if (error.cause instanceof Error) {
    const wrapped = new Error(error.message || "Error");
    wrapped.cause = error.cause;
    return formatErrorCause(wrapped);
  }
  return undefined;
}

function seenRecently(key: string) {
  const now = Date.now();
  for (const [entry, at] of recent) {
    if (now - at > 30_000) recent.delete(entry);
  }
  const previous = recent.get(key);
  if (previous && now - previous < 30_000) return true;
  recent.set(key, now);
  return false;
}

export function reportClientError(error: ClientErrorInput, kind: ClientErrorKind = "boundary") {
  if (typeof window === "undefined") return;
  const name = redactTelemetryText(error.name || "Error", 80);
  const message = redactTelemetryText(error.message, TELEMETRY_MESSAGE_MAX);
  const stack = redactTelemetryText(error.stack, TELEMETRY_STACK_MAX);
  const digest = error.digest?.slice(0, 64);
  const cause = causeText(error);
  const route = routeTemplate(window.location.pathname);
  const key = [kind, name, message, digest, route].join("\n");
  if (seenRecently(key)) return;

  const payload = JSON.stringify({
    name,
    message,
    digest,
    route,
    stack,
    cause,
    kind,
    userAgent: navigator.userAgent.slice(0, 200),
  });
  try {
    const blob = new Blob([payload], { type: "application/json" });
    if (navigator.sendBeacon?.("/api/v1/client/telemetry/error", blob)) return;
  } catch {
    /* fall through */
  }
  void fetch("/api/v1/client/telemetry/error", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
    keepalive: true,
    credentials: "include",
  }).catch(() => undefined);
}

export function bindClientErrorHandlers() {
  if (typeof window === "undefined") return () => undefined;

  function onError(event: ErrorEvent) {
    if (event.target && event.target !== window) return;
    const error = event.error;
    if (error instanceof Error) {
      reportClientError(error, "window");
      return;
    }
    reportClientError({ name: "Error", message: event.message }, "window");
  }

  function onRejection(event: PromiseRejectionEvent) {
    const reason = event.reason;
    if (reason instanceof Error) {
      reportClientError(reason, "rejection");
      return;
    }
    reportClientError({ name: "UnhandledRejection", message: String(reason) }, "rejection");
  }

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
