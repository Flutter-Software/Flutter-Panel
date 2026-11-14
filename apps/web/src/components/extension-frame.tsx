"use client";

/**
 * Host side of the extension bridge.
 *
 * Renders an extension page in a sandboxed iframe (`allow-scripts` without
 * `allow-same-origin`, so its origin is opaque: no cookies, no direct API
 * access) and answers its postMessage requests.
 *
 * Every request goes through two gates:
 *  1. The extension must have been granted the permission the method needs
 *     (`EXTENSION_BRIDGE_METHODS`), as approved by an admin.
 *  2. The call is made with the viewer's own session through the normal API,
 *     so the viewer's server permissions are enforced server-side as usual.
 *
 * The SDK half of the protocol lives in apps/api/src/extension-sdk.ts.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Loader2 } from "lucide-react";
import {
  EXTENSION_API_VERSION,
  EXTENSION_BRIDGE_MARKER,
  EXTENSION_BRIDGE_METHODS,
  type ClientExtension,
  type ClientExtensionPage,
  type ExtensionBridgeMethod,
} from "@flutter-software/shared";
import { useAuth } from "@/components/auth-provider";
import { toast } from "@/components/toast";
import type { ToastVariant } from "@/components/toast";
import { api } from "@/lib/api";
import { ConsoleLink } from "@/lib/extension-console";
import type { ServerRecord } from "@/lib/types";

/** Panel colour tokens mirrored into the frame so extensions can match the theme. */
const THEME_VARS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--border",
  "--input",
  "--ring",
  "--status-running",
  "--status-warn",
  "--status-error",
  "--status-info",
  "--status-offline",
  "--radius-sm",
  "--radius-md",
  "--radius-lg",
];

const TOAST_VARIANTS: ToastVariant[] = ["error", "success", "info", "warning"];
const POWER_ACTIONS = ["start", "stop", "restart", "kill"];
/** Sections `ui.navigate` may open; mirrors the server sidebar. */
const NAV_SECTIONS = /^(console|files|databases|schedules|users|backups|network|startup|settings|activity)([/?#].*)?$/;

type BridgeMessage = {
  [EXTENSION_BRIDGE_MARKER]?: number;
  type?: string;
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
};

function readTheme(mode: "light" | "dark") {
  const style = getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (const name of THEME_VARS) {
    const value = style.getPropertyValue(name).trim();
    if (value) vars[name] = value;
  }
  return { mode, vars };
}

/**
 * Only the fields an extension needs. The full record carries environment
 * variables, which often hold secrets, so it is never forwarded.
 */
function publicServer(server: ServerRecord) {
  return {
    id: server.id,
    uuid: server.uuid ?? null,
    name: server.name,
    description: server.description,
    status: server.status,
    egg: server.egg,
    node: server.node,
    nodeLocation: server.nodeLocation ?? null,
    allocation: server.allocation,
    uptime: server.uptime,
    cpu: server.cpu,
    memory: server.memory,
    disk: server.disk,
  };
}

function stringParam(params: Record<string, unknown>, key: string, required = true) {
  const value = params[key];
  if (typeof value === "string" && (value.length > 0 || !required)) return value;
  throw new Error(`"${key}" must be a${required ? " non-empty" : ""} string`);
}

export function ExtensionFrame({
  server,
  extension,
  page,
}: {
  server: ServerRecord;
  extension: ClientExtension;
  page: ClientExtensionPage;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const router = useRouter();
  const { user } = useAuth();
  const { resolvedTheme } = useTheme();
  const mode: "light" | "dark" = resolvedTheme === "light" ? "light" : "dark";
  const [loaded, setLoaded] = useState(false);

  // Handlers read the latest values through refs so the message listener is bound once per frame.
  const serverRef = useRef(server);
  serverRef.current = server;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const post = useCallback((message: Record<string, unknown>) => {
    // Opaque-origin frames can only be addressed with "*". Identity is
    // guaranteed by posting to this specific contentWindow.
    frameRef.current?.contentWindow?.postMessage({ ...message, [EXTENSION_BRIDGE_MARKER]: 1 }, "*");
  }, []);

  /**
   * Live console stream, owned by the panel so extensions never have to
   * manage sockets or reconnects. Created on first subscribe, torn down when
   * the frame reloads, unsubscribes, or this page unmounts.
   */
  const consoleRef = useRef<ConsoleLink | null>(null);
  const consoleLink = useCallback(() => {
    if (!consoleRef.current) {
      consoleRef.current = new ConsoleLink(serverRef.current.id, (event) =>
        post({ type: "event", event: "console", payload: event }),
      );
      consoleRef.current.setRunning(serverRef.current.status === "running");
    }
    return consoleRef.current;
  }, [post]);
  const stopConsole = useCallback(() => {
    consoleRef.current?.stop();
    consoleRef.current = null;
  }, []);
  useEffect(() => stopConsole, [stopConsole]);
  useEffect(() => {
    consoleRef.current?.setRunning(server.status === "running");
  }, [server.status]);

  const sendInit = useCallback(() => {
    post({
      type: "init",
      context: {
        apiVersion: EXTENSION_API_VERSION,
        extension: {
          id: extension.id,
          name: extension.name,
          version: extension.version,
          permissions: extension.permissions,
          page: page.id,
        },
        server: extension.permissions.includes("server.read") ? publicServer(serverRef.current) : { id: serverRef.current.id },
        user: user ? { id: user.id, username: user.username, admin: user.role === "admin" } : null,
        theme: readTheme(modeRef.current),
      },
    });
  }, [post, extension, page.id, user]);

  /** Executes one bridge call. Throws with a user-readable message on failure. */
  const execute = useCallback(
    async (method: ExtensionBridgeMethod, params: Record<string, unknown>): Promise<unknown> => {
      const serverId = serverRef.current.id;
      const base = `/api/v1/client/servers/${serverId}`;
      const files = (body: Record<string, unknown>) =>
        api<{ data: unknown }>(`${base}/files`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.data);

      switch (method) {
        case "server.get":
          return publicServer(serverRef.current);
        case "console.logs":
          return api<{ data: unknown }>(`${base}/console`).then((r) => r.data);
        case "console.subscribe": {
          const link = consoleLink();
          try {
            await link.start();
          } catch (err) {
            // Couldn't attach in time (node down, no console permission): don't keep retrying in the background.
            stopConsole();
            throw err;
          }
          return { state: link.state };
        }
        case "console.unsubscribe":
          stopConsole();
          return { state: "closed" };
        case "console.command":
          return api<{ data: unknown }>(`${base}/command`, {
            method: "POST",
            body: JSON.stringify({ command: stringParam(params, "command") }),
          }).then((r) => r.data);
        case "files.list":
          return files({ action: "list", path: typeof params.path === "string" ? params.path : "/" });
        case "files.read":
          return files({ action: "read", path: stringParam(params, "path") });
        case "files.write":
          return files({
            action: "write",
            path: stringParam(params, "path"),
            content: stringParam(params, "content", false),
          });
        case "server.power": {
          const action = stringParam(params, "action");
          if (!POWER_ACTIONS.includes(action)) throw new Error(`Unknown power action "${action}"`);
          return api<{ data: unknown }>(`${base}/power`, { method: "POST", body: JSON.stringify({ action }) }).then(
            (r) => r.data,
          );
        }
        case "ui.toast": {
          const message = stringParam(params, "message").slice(0, 300);
          const variant = TOAST_VARIANTS.includes(params.variant as ToastVariant) ? (params.variant as ToastVariant) : "info";
          toast(`${extension.name}: ${message}`, variant);
          return { ok: true };
        }
        case "ui.navigate": {
          const section = stringParam(params, "section").replace(/^\/+/, "");
          if (!NAV_SECTIONS.test(section)) throw new Error(`Cannot navigate to "${section}"`);
          router.push(`/server/${serverId}/${section}`);
          return { ok: true };
        }
      }
    },
    [extension.name, router, consoleLink, stopConsole],
  );

  // Bridge listener.
  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      const frame = frameRef.current?.contentWindow;
      if (!frame || event.source !== frame) return;
      const msg = event.data as BridgeMessage;
      if (!msg || msg[EXTENSION_BRIDGE_MARKER] !== 1) return;

      if (msg.type === "hello") {
        // A (re)loaded document starts clean: drop any stream the previous one held.
        stopConsole();
        sendInit();
        return;
      }
      if (msg.type !== "request" || typeof msg.id !== "number" || typeof msg.method !== "string") return;

      const id = msg.id;
      const method = msg.method;
      const reply = (ok: boolean, payload: unknown) =>
        post(ok ? { type: "response", id, ok, result: payload } : { type: "response", id, ok, error: payload });

      if (!(method in EXTENSION_BRIDGE_METHODS)) {
        reply(false, `Unknown method "${method}"`);
        return;
      }
      const typed = method as ExtensionBridgeMethod;
      const needed = EXTENSION_BRIDGE_METHODS[typed];
      if (needed && !extension.permissions.includes(needed)) {
        reply(false, `This extension was not granted the "${needed}" permission`);
        return;
      }
      try {
        const params = msg.params && typeof msg.params === "object" ? msg.params : {};
        reply(true, await execute(typed, params));
      } catch (err) {
        reply(false, err instanceof Error ? err.message : "Request failed");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [execute, extension.permissions, post, sendInit, stopConsole]);

  // Live updates: theme switches and server record changes.
  useEffect(() => {
    if (!loaded) return;
    // Wait a frame so next-themes has applied the new class before reading tokens.
    const handle = requestAnimationFrame(() => post({ type: "event", event: "theme", payload: readTheme(mode) }));
    return () => cancelAnimationFrame(handle);
  }, [mode, loaded, post]);

  useEffect(() => {
    if (!loaded || !extension.permissions.includes("server.read")) return;
    post({ type: "event", event: "server", payload: publicServer(server) });
  }, [server, loaded, extension.permissions, post]);

  return (
    <div className="relative flex h-full min-h-[28rem] flex-col overflow-hidden rounded-xl border border-border bg-card">
      {!loaded ? (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading {extension.name}…
        </div>
      ) : null}
      <iframe
        ref={frameRef}
        key={page.src}
        src={page.src}
        title={`${extension.name}: ${page.label}`}
        // No allow-same-origin: the frame gets an opaque origin and can't touch the panel session.
        sandbox="allow-scripts allow-forms allow-popups allow-downloads"
        referrerPolicy="no-referrer"
        className="min-h-0 w-full flex-1 border-0 bg-transparent"
        onLoad={() => {
          setLoaded(true);
          // Fallback for frames that loaded the SDK before our listener attached.
          sendInit();
        }}
      />
    </div>
  );
}
