export const PANEL_VERSION = "0.2.60";

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

export const NODE_ONLINE_MS = 120_000;
export const DAEMON_HEARTBEAT_MS = 15_000;
export const DAEMON_REQUEST_TTL_MS = 60_000;

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
