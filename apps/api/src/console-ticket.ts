import { createHmac, timingSafeEqual } from "node:crypto";

export type ConsoleTicket = {
  v: 1;
  serverId: string;
  uuid: string;
  nodeId: string;
  userId: string;
  expiresAt: number;
};

function sign(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function signConsoleTicket(
  secret: string,
  input: Omit<ConsoleTicket, "v" | "expiresAt">,
  ttlMs = 5 * 60_000,
): string {
  const payload: ConsoleTicket = {
    v: 1,
    ...input,
    expiresAt: Date.now() + ttlMs,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

export function verifyConsoleTicket(secret: string, token: string | null | undefined): ConsoleTicket | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(secret, body);
  try {
    const a = Buffer.from(signature, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ConsoleTicket;
    if (payload?.v !== 1 || !payload.uuid || !payload.nodeId || Date.now() > payload.expiresAt) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
