type LogLevel = "info" | "warn" | "error";

type LogOptions = {
  telemetry?: boolean;
};

let telemetryMod: Promise<typeof import("./telemetry")> | undefined;

function telemetry() {
  return (telemetryMod ??= import("./telemetry"));
}

function flatten(extra: Record<string, unknown>, into: Record<string, unknown>) {
  for (const key in extra) {
    const value = extra[key];
    if (value instanceof Error) {
      into[key] = value.message;
      if (value.stack) into[`${key}Stack`] = value.stack;
    } else {
      into[key] = value;
    }
  }
}

export function log(
  level: LogLevel,
  msg: string,
  extra: Record<string, unknown> = {},
  options?: LogOptions,
) {
  const line: Record<string, unknown> = {
    level,
    msg,
    time: new Date().toISOString(),
  };
  flatten(extra, line);
  console.log(JSON.stringify(line));

  if (level === "info" || options?.telemetry === false) return;
  void telemetry()
    .then((mod) => mod.trackLoggedError(msg, extra, level))
    .catch(() => undefined);
}