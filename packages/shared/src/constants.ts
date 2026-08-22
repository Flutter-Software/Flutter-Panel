export const PANEL_VERSION = "0.2.5";

export const SESSION_COOKIE = "flutter_session";
export const CSRF_COOKIE = "flutter_csrf";
export const CSRF_HEADER = "x-flutter-csrf";

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
export const CSRF_TTL_MS = 1000 * 60 * 60 * 12;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export const NODE_ONLINE_MS = 120_000;
export const DAEMON_HEARTBEAT_MS = 15_000;
export const DAEMON_REQUEST_TTL_MS = 60_000;
