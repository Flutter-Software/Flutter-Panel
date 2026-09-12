export const PANEL_VERSION = "0.2.71";

export const SESSION_COOKIE = "flutter_session";
export const CSRF_COOKIE = "flutter_csrf";
export const CSRF_HEADER = "x-flutter-csrf";

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
export const CSRF_TTL_MS = 1000 * 60 * 60 * 12;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
export const EMAIL_VERIFY_TTL_MS = 1000 * 60 * 10;
export const TOTP_CHALLENGE_TTL_MS = 1000 * 60 * 5;
export const SSO_LOGIN_TTL_MS = 1000 * 60;
export const SSO_LOGIN_TOKEN_PREFIX = "flsso_";

export const DEFAULT_SITE_NAME = "Flutter";
export const DEFAULT_CONSOLE_TAG = "Flutter";
export const CONSOLE_TAG_MAX_LENGTH = 24;

export function normalizeConsoleTag(value: string | null | undefined) {
  const tag = String(value ?? "")
    .replace(/[\n\r]+/g, " ")
    .replace(/[\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CONSOLE_TAG_MAX_LENGTH);
  return tag || DEFAULT_CONSOLE_TAG;
}

export const NODE_ONLINE_MS = 120_000;
export const DAEMON_HEARTBEAT_MS = 15_000;
export const DAEMON_REQUEST_TTL_MS = 60_000;

export function isLoopbackHost(value: string) {
  let host = value.trim().toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    host = end >= 0 ? host.slice(1, end) : host.replace(/^\[|\]$/g, "");
  } else if (/^\d{1,3}(\.\d{1,3}){3}(?::\d+)?$/.test(host) || host.startsWith("localhost:")) {
    host = host.split(":")[0] ?? host;
  }
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host === "";
}

export function isLoopbackUrl(value: string) {
  try {
    return isLoopbackHost(new URL(value).hostname);
  } catch {
    return /localhost|127\.0\.0\.1|\[?::1\]?/i.test(value);
  }
}

export const FILE_UPLOAD_LIMIT_BYTES = 250 * 1024 * 1024;
export const FILE_OPEN_LIMIT_BYTES = 250 * 1024 * 1024;

export function uploadLimitBytes(mb?: number | null) {
  const value = Number(mb);
  if (!Number.isFinite(value) || value <= 0) return FILE_UPLOAD_LIMIT_BYTES;
  return Math.round(value * 1024 * 1024);
}

export function formatUploadLimit(bytes: number) {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    const gb = mb / 1024;
    return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
  }
  return Number.isInteger(mb) ? `${mb} MB` : `${mb.toFixed(1)} MB`;
}
