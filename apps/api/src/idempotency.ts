import { createHash } from "node:crypto";
import type { Context, Next } from "hono";
import { FlutterError } from "@flutter-software/shared";

/**
 * Idempotency-Key support for writes (POST/PUT/PATCH/DELETE).
 *
 * The web client sends a fresh random key with every write and retries once
 * on a network error with the same key. If the first attempt actually reached
 * us, the retry gets the first response replayed instead of running the
 * handler again (no double-created servers, no double-sent invites).
 *
 * How it works:
 * - Requests without the header are untouched (daemon, API keys, curl).
 * - Keys are scoped to the caller's credentials (a hash of the Cookie and
 *   Authorization headers) plus method and path, so one user can never replay
 *   another user's response, and a key can't be reused against a different
 *   endpoint.
 * - While the first request is still running, a duplicate waits for it and
 *   then gets the same answer.
 * - Only JSON responses below 5xx that don't set cookies are stored. Server
 *   errors are not cached, so a retry after a crash really retries. Non-JSON
 *   (downloads, streams) and cookie-setting responses pass through and are
 *   forgotten.
 *
 * Storage is in-process memory with a TTL. The panel runs one API process; if
 * it's ever scaled out, move this map to Redis (see redis.ts).
 */

const HEADER = "idempotency-key";
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5000;
const MAX_BODY_BYTES = 1024 * 1024;
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type Stored = { status: number; body: string; contentType: string };
type Entry = { expiresAt: number; done: Promise<Stored | null>; result?: Stored | null };

const entries = new Map<string, Entry>();

function sweep(now: number) {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }
  // Still too big (a burst of writes): drop the oldest. Map keeps insertion order.
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

function scopeKey(c: Context, key: string) {
  const credentials = `${c.req.header("cookie") ?? ""}\n${c.req.header("authorization") ?? ""}`;
  return createHash("sha256")
    .update(credentials)
    .update("\n")
    .update(c.req.method.toUpperCase())
    .update("\n")
    .update(c.req.path)
    .update("\n")
    .update(key)
    .digest("hex");
}

function replay(c: Context, stored: Stored) {
  return new Response(stored.body, {
    status: stored.status,
    headers: {
      "content-type": stored.contentType,
      "idempotent-replayed": "true",
      "x-request-id": String(c.get("requestId") ?? ""),
    },
  });
}

export async function idempotency(c: Context, next: Next) {
  const raw = c.req.header(HEADER);
  if (!raw || !WRITE_METHODS.has(c.req.method.toUpperCase())) return next();
  if (!KEY_PATTERN.test(raw)) {
    throw FlutterError.validation("Idempotency-Key must be 8-128 letters, digits, '-' or '_'.");
  }

  const now = Date.now();
  sweep(now);
  const key = scopeKey(c, raw);

  const existing = entries.get(key);
  if (existing && existing.expiresAt > now) {
    const stored = existing.result !== undefined ? existing.result : await existing.done;
    if (stored) return replay(c, stored);
    // The first attempt wasn't cacheable (5xx, non-JSON): let this one run.
  }

  let resolve!: (value: Stored | null) => void;
  const entry: Entry = {
    expiresAt: now + TTL_MS,
    done: new Promise<Stored | null>((r) => {
      resolve = r;
    }),
  };
  entries.set(key, entry);

  let stored: Stored | null = null;
  try {
    await next();
    const res = c.res;
    const contentType = res.headers.get("content-type") ?? "";
    // Responses that set cookies (login, logout, CSRF bootstrap) are never
    // replayed: a replay can't safely re-issue the cookie, and the client would
    // end up believing it has a session it doesn't.
    const setsCookie = res.headers.has("set-cookie");
    if (res.status < 500 && !setsCookie && contentType.includes("application/json")) {
      const body = await res.clone().text();
      if (body.length <= MAX_BODY_BYTES) {
        stored = { status: res.status, body, contentType };
      }
    }
  } finally {
    // Errors thrown by the handler become onError responses after this point;
    // they're not stored, so a retry runs the handler again.
    entry.result = stored;
    if (!stored) entries.delete(key);
    resolve(stored);
  }
}
