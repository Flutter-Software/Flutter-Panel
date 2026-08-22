import { FlutterError, NODE_ONLINE_MS } from "@flutter-software/shared";
import { Node } from "./db/models";
import { dummyPasswordHash, verifyPassword } from "./auth/crypto";
import { env } from "./env";

export function isNodeOnline(lastHeartbeatAt: Date | null | undefined) {
  return !!lastHeartbeatAt && Date.now() - lastHeartbeatAt.getTime() < NODE_ONLINE_MS;
}

export async function authenticateNodeToken(token: string, nodeId: string) {
  const node = await Node.findById(nodeId);
  const hash = node?.tokenHash ?? (await dummyPasswordHash());
  const ok = await verifyPassword(hash, token);
  if (!node || !ok) throw FlutterError.unauthorized("Invalid node token");
  return node;
}

export async function requireOnlineNode(nodeId: string) {
  const node = await Node.findById(nodeId);
  if (!node) throw FlutterError.notFound("Node not found");
  if (!isNodeOnline(node.lastHeartbeatAt) || !node.daemonListenUrl) {
    throw FlutterError.unavailable(
      "Node daemon is offline. Start the daemon and wait for a heartbeat.",
    );
  }
  return node;
}

export function panelApiUrl(requestOrigin?: string) {
  const origin = requestOrigin?.replace(/\/+$/, "") || "";
  if (origin) return origin;
  const app = env().APP_URL.replace(/\/+$/, "");
  try {
    const host = new URL(app).hostname;
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") return app;
  } catch {
    /* ignore */
  }
  return env().API_INTERNAL_URL.replace(/\/+$/, "");
}
