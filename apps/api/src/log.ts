export function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      level,
      msg,
      time: new Date().toISOString(),
      ...extra,
    }),
  );
}
