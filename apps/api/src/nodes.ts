import { FlutterError, NODE_ONLINE_MS } from "@flutter-software/shared";
import { Node } from "./db/models";
import { dummyPasswordHash, hashPassword, tokenEquals, verifyPassword } from "./auth/crypto";
import { env } from "./env";

export function isNodeOnline(lastHeartbeatAt: Date | null | undefined) {
  return !!lastHeartbeatAt && Date.now() - lastHeartbeatAt.getTime() < NODE_ONLINE_MS;
}

export async function authenticateNodeToken(token: string, nodeId: string) {
  const node = await Node.findById(nodeId);
  if (!node) {
    await verifyPassword(await dummyPasswordHash(), token);
    throw FlutterError.unauthorized(
      "Unknown node id. Use the id from Admin → Nodes for this machine, not another panel.",
    );
  }

  // Copy-to-clipboard needs the plaintext. We also keep an argon2 hash so
  // older rows (hash only) still authenticate, then backfill daemonToken.
  const stored = node.daemonToken ? String(node.daemonToken) : "";
  if (stored && tokenEquals(stored, token)) {
    if (!node.tokenHash) {
      node.tokenHash = await hashPassword(token);
      await node.save();
    }
    return node;
  }

  const hash = node.tokenHash ? String(node.tokenHash) : "";
  const matchesHash = hash ? await verifyPassword(hash, token) : false;
  if (!matchesHash) {
    await verifyPassword(hash || (await dummyPasswordHash()), token);
    throw FlutterError.unauthorized(
      "Invalid node token. Copy the token from the same node row as --node (clipboard button).",
    );
  }

  node.daemonToken = token;
  node.tokenPrefix = token.slice(0, 12);
  await node.save();
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
