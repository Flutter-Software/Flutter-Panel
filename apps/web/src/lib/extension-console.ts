/**
 * Live console link used by the extension bridge.
 *
 * Extensions shouldn't have to manage websockets, tickets or reconnects to
 * keep a console attached, so the panel does it for them: while at least one
 * extension subscription is open, this keeps a console socket connected and
 * re-attaches automatically after
 *  - the socket dropping (network blip, API restart, laptop sleep),
 *  - the server restarting (the daemon closes the stream),
 *  - the tab coming back to the foreground with a dead socket,
 *  - the stream going silent past the watchdog while the server is running.
 *
 * Speaks the same protocol as the Console page (/api/v1/ws/console).
 */
import { api } from "@/lib/api";
import { browserConsoleSocketUrl } from "@/lib/console-socket";
import { stripConsoleAnsi } from "@/lib/console-ansi";

export type ConsoleLinkState = "connecting" | "attached" | "reconnecting" | "closed";

export type ConsoleLinkEvent =
  | { type: "state"; state: ConsoleLinkState; attempt: number }
  | { type: "history"; lines: string[] }
  | { type: "line"; line: string }
  | { type: "status"; status: string };

const RETRY_MIN_MS = 400;
const RETRY_MAX_MS = 5_000;
/**
 * A running server with no traffic at all for this long is treated as a dead
 * stream and re-attached. The daemon pushes stats every second while it is
 * pumping a running server, so silence this long means the pipe is gone,
 * not just a quiet game.
 */
const SILENCE_WATCHDOG_MS = 20_000;

/** Docker attach handshake echoed into the stream; never useful to an extension. */
function isAttachNoise(line: string) {
  return /"hijack"\s*:\s*true/.test(line) && /"stream"\s*:\s*true/.test(line);
}

export class ConsoleLink {
  private ws: WebSocket | null = null;
  private stopped = true;
  private attempt = 0;
  private retryMs = RETRY_MIN_MS;
  private retryTimer: number | undefined;
  private watchdog: number | undefined;
  private lastTraffic = 0;
  private running = false;
  private stateValue: ConsoleLinkState = "closed";
  private readonly waiters: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

  constructor(
    private readonly serverId: string,
    private readonly emit: (event: ConsoleLinkEvent) => void,
  ) {}

  get state() {
    return this.stateValue;
  }

  /**
   * Seeds/updates whether the server is running, from the panel's server
   * record. The silence watchdog only applies to running servers, so an
   * offline server doesn't cause a reconnect loop.
   */
  setRunning(running: boolean) {
    this.running = running;
  }

  /** Starts (or keeps) the link. Resolves once attached, rejects after `timeoutMs`. */
  start(timeoutMs = 15_000): Promise<void> {
    if (this.stopped) {
      this.stopped = false;
      document.addEventListener("visibilitychange", this.onVisible);
      window.addEventListener("online", this.onVisible);
      void this.connect();
    }
    if (this.stateValue === "attached") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      this.waiters.push(waiter);
      window.setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index === -1) return;
        this.waiters.splice(index, 1);
        reject(new Error("Could not attach to the console. Is the node online?"));
      }, timeoutMs);
    });
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("online", this.onVisible);
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.watchdog);
    this.watchdog = undefined;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.waiters.splice(0).forEach((waiter) => waiter.reject(new Error("Console subscription closed")));
    this.setState("closed");
  }

  /** Coming back from a background tab or offline: reconnect now instead of waiting out the backoff. */
  private onVisible = () => {
    if (this.stopped || document.hidden) return;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    window.clearTimeout(this.retryTimer);
    this.retryMs = RETRY_MIN_MS;
    void this.connect();
  };

  private setState(state: ConsoleLinkState) {
    if (this.stateValue === state) return;
    this.stateValue = state;
    this.emit({ type: "state", state, attempt: this.attempt });
    if (state === "attached") this.waiters.splice(0).forEach((waiter) => waiter.resolve());
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    this.setState("reconnecting");
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => void this.connect(), this.retryMs);
    this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 1.6);
  }

  private async connect() {
    if (this.stopped) return;
    this.attempt += 1;
    this.setState(this.attempt === 1 ? "connecting" : "reconnecting");
    try {
      // Tickets are short-lived and single-use; mint a fresh one per attempt.
      const result = await api<{ data: { token: string; socket: string } }>(
        `/api/v1/client/servers/${this.serverId}/console/socket`,
      );
      if (this.stopped) return;
      const ws = new WebSocket(browserConsoleSocketUrl(result.data.token, result.data.socket));
      this.ws = ws;

      ws.onopen = () => {
        if (this.ws !== ws) return;
        this.retryMs = RETRY_MIN_MS;
        this.lastTraffic = Date.now();
        this.armWatchdog();
        this.setState("attached");
      };
      ws.onmessage = (event) => {
        if (this.ws !== ws) return;
        this.lastTraffic = Date.now();
        this.handle(String(event.data));
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.scheduleReconnect();
      };
    } catch {
      // Ticket request failed (API restarting, permission revoked...). Keep trying with backoff.
      this.scheduleReconnect();
    }
  }

  private armWatchdog() {
    window.clearInterval(this.watchdog);
    this.watchdog = window.setInterval(() => {
      if (!this.ws || !this.running) return;
      if (Date.now() - this.lastTraffic < SILENCE_WATCHDOG_MS) return;
      // Silent while running: the daemon side of the pipe is gone. Force a re-attach.
      this.ws.close();
    }, 5_000);
  }

  private handle(raw: string) {
    let parsed: { event?: string; data?: string };
    try {
      parsed = JSON.parse(raw) as { event?: string; data?: string };
    } catch {
      this.emitLine(raw);
      return;
    }
    switch (parsed.event) {
      case "history": {
        let rows: unknown = [];
        try {
          rows = parsed.data ? JSON.parse(parsed.data) : [];
        } catch {
          rows = [];
        }
        const lines = Array.isArray(rows)
          ? rows.filter((line): line is string => typeof line === "string" && !isAttachNoise(line))
          : [];
        this.emit({ type: "history", lines });
        return;
      }
      case "cleared":
        this.emit({ type: "history", lines: [] });
        return;
      case "output":
        if (parsed.data !== undefined) this.emitLine(parsed.data);
        return;
      case "status":
        if (parsed.data) {
          this.running = parsed.data === "running" || parsed.data === "starting";
          this.emit({ type: "status", status: parsed.data });
        }
        return;
      case "stats":
        // Counts as traffic for the watchdog (handled in onmessage); nothing to forward.
        return;
      default:
        return;
    }
  }

  private emitLine(line: string) {
    if (isAttachNoise(line) || !stripConsoleAnsi(line).trim()) return;
    this.emit({ type: "line", line });
  }
}
