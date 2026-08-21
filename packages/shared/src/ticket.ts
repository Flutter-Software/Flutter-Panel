import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DAEMON_REQUEST_TTL_MS } from "./constants";

export type DaemonRequestClaims = {
  v: 1;
  nodeId: string;
  serverUuid: string;
  op: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

function signBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function signDaemonRequest(
  secret: string,
  input: {
    nodeId: string;
    serverUuid: string;
    op: string;
    ttlMs?: number;
  },
): string {
  const issuedAt = Date.now();
  const payload: DaemonRequestClaims = {
    v: 1,
    nodeId: input.nodeId,
    serverUuid: input.serverUuid,
    op: input.op,
    issuedAt,
    expiresAt: issuedAt + (input.ttlMs ?? DAEMON_REQUEST_TTL_MS),
    nonce: randomBytes(8).toString("hex"),
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${signBody(secret, body)}`;
}

export function verifyDaemonRequest(
  secret: string,
  token: string | null | undefined,
): { ok: true; data: DaemonRequestClaims } | { ok: false; error: { code: string; message: string } } {
  if (!token) {
    return { ok: false, error: { code: "DAEMON_TICKET_REQUIRED", message: "A panel-signed daemon ticket is required." } };
  }

  const dot = token.indexOf(".");
  if (dot <= 0) {
    return { ok: false, error: { code: "DAEMON_TICKET_INVALID", message: "Daemon ticket is malformed." } };
  }

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = signBody(secret, body);

  try {
    const a = Buffer.from(signature, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, error: { code: "DAEMON_TICKET_INVALID", message: "Daemon ticket is invalid." } };
    }
  } catch {
    return { ok: false, error: { code: "DAEMON_TICKET_INVALID", message: "Daemon ticket is invalid." } };
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as DaemonRequestClaims;
    if (
      payload?.v !== 1 ||
      !payload.nodeId ||
      !payload.serverUuid ||
      !payload.op ||
      !payload.expiresAt
    ) {
      return { ok: false, error: { code: "DAEMON_TICKET_INVALID", message: "Daemon ticket is malformed." } };
    }
    if (Date.now() > payload.expiresAt) {
      return { ok: false, error: { code: "DAEMON_TICKET_EXPIRED", message: "Daemon ticket has expired." } };
    }
    return { ok: true, data: payload };
  } catch {
    return { ok: false, error: { code: "DAEMON_TICKET_INVALID", message: "Daemon ticket is malformed." } };
  }
}

export function readBearerToken(header: string | null | undefined): string {
  if (!header) return "";
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match?.[1] ?? "";
}
