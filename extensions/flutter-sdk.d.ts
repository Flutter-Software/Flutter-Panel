/**
 * Type definitions for the Flutter Panel extension SDK (`window.Flutter`).
 *
 * The SDK is injected by the panel (`/api/v1/extensions/sdk.js`); this file
 * only describes it for your editor. Reference it from a TypeScript extension:
 *
 *   /// <reference path="../flutter-sdk.d.ts" />
 *
 * or add it to your tsconfig "include"/"files". See extensions/README.md.
 */

declare namespace FlutterSDK {
  type Permission = "server.read" | "console.read" | "console.command" | "files.read" | "files.write" | "power";
  type ServerStatus = "offline" | "starting" | "running" | "stopping" | "installing" | "install_failed" | (string & {});
  type ConsoleState = "closed" | "connecting" | "attached" | "reconnecting";
  type ToastVariant = "info" | "success" | "warning" | "error";
  type PowerAction = "start" | "stop" | "restart" | "kill";

  interface Server {
    id: string;
    uuid: string | null;
    name: string;
    description: string;
    status: ServerStatus;
    egg: string;
    node: string;
    nodeLocation: string | null;
    allocation: string;
    uptime: string;
    cpu: { used: number; limit: number };
    memory: { usedMb: number; limitMb: number };
    disk: { usedMb: number; limitMb: number };
  }

  interface Theme {
    mode: "light" | "dark";
    /** CSS custom properties, e.g. { "--primary": "..." }. Already applied to :root. */
    vars: Record<string, string>;
  }

  interface Context {
    apiVersion: number;
    extension: { id: string; name: string; version: string; permissions: Permission[]; page: string };
    /** Full record with `server.read`, otherwise only `{ id }`. */
    server: Server;
    user: { id: string; username: string; admin: boolean } | null;
    theme: Theme;
  }

  interface FileEntry {
    name: string;
    kind: "file" | "dir";
    size: number;
    modifiedAt: string;
    createdAt?: string | null;
  }

  interface ConsoleHandlers {
    /** `raw` keeps ANSI colour codes; `plain` has them stripped. */
    onLine?(raw: string, plain: string): void;
    /** Recent backlog, delivered on every (re)attach. */
    onHistory?(lines: string[]): void;
    onState?(state: ConsoleState, attempt: number): void;
    onStatus?(status: ServerStatus): void;
  }

  interface ConsoleSubscription {
    /** Resolves once the stream is attached the first time. */
    ready: Promise<void>;
    /** Stops listening. The stream closes when the last subscriber closes. */
    close(): void;
  }

  interface RunOptions {
    /** Resolve with the first line matching this (tested against the plain line). */
    match?: RegExp | ((plain: string) => unknown);
    /** With `match`: reject after this many ms. Default 5000. */
    timeout?: number;
    /** Without `match`: resolve with every line seen this long after sending. Default 750. */
    settle?: number;
  }

  interface RunMatch {
    line: string;
    plain: string;
    match: RegExpMatchArray | unknown;
    lines: string[];
  }

  interface SDK {
    readonly apiVersion: number;
    readonly context: Context | null;
    ready(): Promise<Context>;
    on(event: "init", fn: (context: Context) => void): () => void;
    on(event: "server", fn: (server: Server) => void): () => void;
    on(event: "theme", fn: (theme: Theme) => void): () => void;
    on(event: string, fn: (payload: unknown) => void): () => void;
    call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;

    server: {
      get(): Promise<Server>;
      power(action: PowerAction): Promise<unknown>;
    };
    console: {
      logs(): Promise<{ running: boolean; lines: string[] }>;
      command(command: string): Promise<{ ok: true }>;
      subscribe(handlers?: ConsoleHandlers): ConsoleSubscription;
      run(command: string, options: RunOptions & { match: RegExp | ((plain: string) => unknown) }): Promise<RunMatch>;
      run(command: string, options?: RunOptions): Promise<{ lines: string[] }>;
      readonly state: ConsoleState;
      stripAnsi(line: string): string;
    };
    files: {
      list(path?: string): Promise<{ path: string; entries: FileEntry[] }>;
      read(path: string): Promise<{ path: string; content: string }>;
      write(path: string, content: string): Promise<{ path: string; size: number }>;
    };
    ui: {
      toast(message: string, variant?: ToastVariant): Promise<{ ok: true }>;
      navigate(section: string): Promise<{ ok: true }>;
    };
  }
}

declare const Flutter: FlutterSDK.SDK;

interface Window {
  Flutter: FlutterSDK.SDK;
}
