/**
 * Browser SDK served at `GET /api/v1/extensions/sdk.js`.
 *
 * Extensions include it with:
 *   <script src="/api/v1/extensions/sdk.js"></script>
 * and get a global `Flutter` object. It is plain ES2017 with no build step so
 * extension authors can write a single HTML file.
 *
 * Protocol (all messages carry `__flutterExtension: 1`):
 *   frame -> panel  { type: "hello", apiVersion }
 *   panel -> frame  { type: "init", context }
 *   frame -> panel  { type: "request", id, method, params }
 *   panel -> frame  { type: "response", id, ok, result | error }
 *   panel -> frame  { type: "event", event, payload }   ("theme", "server", "console")
 *
 * Console streaming: the panel owns the websocket and keeps it attached
 * (reconnects, server restarts, sleeping tabs). The SDK only reference-counts
 * local subscribers and calls console.subscribe / console.unsubscribe.
 *
 * Keep the source free of backticks and "${" — it lives in a template literal.
 */
export const EXTENSION_SDK_SOURCE = String.raw`/* Flutter Panel extension SDK v1 */
(function () {
  "use strict";
  if (window.Flutter) return;

  var MARKER = "__flutterExtension";
  var API_VERSION = 1;
  var REQUEST_TIMEOUT_MS = 60000;

  var seq = 0;
  var pending = {};
  var listeners = {};
  var context = null;
  var readyWaiters = [];
  var ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

  /* Console stream state (see console.subscribe below). */
  var consoleSubs = [];
  var consoleState = "closed";
  var consoleAttach = null; // Promise while subscribed

  function post(message) {
    message[MARKER] = 1;
    // The frame's origin is opaque, so the parent is addressed with "*".
    // Only requests travel this way; the panel decides what to answer.
    window.parent.postMessage(message, "*");
  }

  function emit(event, payload) {
    (listeners[event] || []).slice().forEach(function (fn) {
      try { fn(payload); } catch (err) { console.error("[Flutter] listener for '" + event + "' threw", err); }
    });
  }

  /** Mirrors the panel's colour tokens as CSS variables on :root. */
  function applyTheme(theme) {
    if (!theme) return;
    var root = document.documentElement;
    root.dataset.theme = theme.mode;
    root.style.colorScheme = theme.mode;
    var vars = theme.vars || {};
    Object.keys(vars).forEach(function (name) { root.style.setProperty(name, vars[name]); });
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var msg = event.data;
    if (!msg || msg[MARKER] !== 1) return;

    if (msg.type === "init") {
      context = msg.context;
      applyTheme(context.theme);
      var waiters = readyWaiters.splice(0);
      waiters.forEach(function (resolve) { resolve(context); });
      emit("init", context);
    } else if (msg.type === "response") {
      var entry = pending[msg.id];
      if (!entry) return;
      delete pending[msg.id];
      clearTimeout(entry.timer);
      if (msg.ok) entry.resolve(msg.result);
      else entry.reject(new Error(msg.error || "Request failed"));
    } else if (msg.type === "event") {
      if (msg.event === "theme") {
        if (context) context.theme = msg.payload;
        applyTheme(msg.payload);
      }
      if (msg.event === "server" && context) context.server = msg.payload;
      if (msg.event === "console") dispatchConsole(msg.payload);
      emit(msg.event, msg.payload);
    }
  });

  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      var timer = setTimeout(function () {
        if (!pending[id]) return;
        delete pending[id];
        reject(new Error("Timed out waiting for the panel (" + method + ")"));
      }, REQUEST_TIMEOUT_MS);
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      post({ type: "request", id: id, method: method, params: params || {} });
    });
  }

  function stripAnsi(line) {
    return String(line).replace(ANSI, "");
  }

  function dispatchConsole(event) {
    if (!event) return;
    if (event.type === "state") consoleState = event.state;
    consoleSubs.slice().forEach(function (sub) {
      try {
        if (event.type === "line" && sub.onLine) sub.onLine(event.line, stripAnsi(event.line));
        else if (event.type === "history" && sub.onHistory) sub.onHistory(event.lines);
        else if (event.type === "state" && sub.onState) sub.onState(event.state, event.attempt);
        else if (event.type === "status" && sub.onStatus) sub.onStatus(event.status);
      } catch (err) {
        console.error("[Flutter] console subscriber threw", err);
      }
    });
  }

  /**
   * Keeps the live console attached for as long as the returned handle is
   * open. Handlers: onLine(rawLine, plainLine), onHistory(lines),
   * onState(state, attempt), onStatus(status). States: "connecting",
   * "attached", "reconnecting", "closed". Reconnects are automatic.
   */
  function subscribeConsole(handlers) {
    var sub = handlers || {};
    consoleSubs.push(sub);
    if (!consoleAttach) {
      consoleAttach = call("console.subscribe").catch(function (err) {
        consoleAttach = null;
        throw err;
      });
    }
    var closed = false;
    return {
      /** Resolves once the stream is attached (first time). */
      ready: consoleAttach.then(function () {}),
      close: function () {
        if (closed) return;
        closed = true;
        consoleSubs = consoleSubs.filter(function (item) { return item !== sub; });
        if (!consoleSubs.length && consoleAttach) {
          consoleAttach = null;
          call("console.unsubscribe").catch(function () {});
        }
      },
    };
  }

  /**
   * Sends a command and collects its output from the live stream. Attaches
   * BEFORE sending, so a fast reply can't be missed.
   *   options.match     RegExp or function(plainLine) -> resolve with the first match
   *   options.timeout   ms to wait for a match (default 5000), rejects after
   *   options.settle    without match: resolve with every line seen this long after sending (default 750)
   * Resolves with { line, plain, match, lines } (match variant) or { lines } (settle variant).
   */
  function runCommand(command, options) {
    var opts = options || {};
    var matcher = opts.match;
    var test = typeof matcher === "function"
      ? matcher
      : matcher instanceof RegExp
        ? function (plain) { return plain.match(matcher); }
        : null;
    var timeoutMs = typeof opts.timeout === "number" ? opts.timeout : 5000;
    var settleMs = typeof opts.settle === "number" ? opts.settle : 750;

    return new Promise(function (resolve, reject) {
      var lines = [];
      var done = false;
      var timer = null;
      var handle = subscribeConsole({
        onLine: function (raw, plain) {
          if (done) return;
          lines.push(plain);
          if (!test) return;
          var result = test(plain);
          if (result) finish(resolve, { line: raw, plain: plain, match: result, lines: lines });
        },
      });

      function finish(fn, value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        handle.close();
        fn(value);
      }

      handle.ready
        .then(function () { return call("console.command", { command: command }); })
        .then(function () {
          timer = setTimeout(function () {
            if (test) finish(reject, new Error("No matching console output within " + timeoutMs + " ms"));
            else finish(resolve, { lines: lines });
          }, test ? timeoutMs : settleMs);
        })
        .catch(function (err) { finish(reject, err); });
    });
  }

  var Flutter = {
    apiVersion: API_VERSION,

    /** Resolves with the context once the panel has answered the handshake. */
    ready: function () {
      if (context) return Promise.resolve(context);
      return new Promise(function (resolve) { readyWaiters.push(resolve); });
    },

    /** Current context ({ extension, server, user, theme }) or null before ready(). */
    get context() { return context; },

    /** Subscribe to "init", "theme" or "server". Returns an unsubscribe function. */
    on: function (event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
      return function () {
        listeners[event] = (listeners[event] || []).filter(function (item) { return item !== fn; });
      };
    },

    /** Low-level escape hatch: call any bridge method by name. */
    call: call,

    server: {
      get: function () { return call("server.get"); },
      power: function (action) { return call("server.power", { action: action }); },
    },
    console: {
      logs: function () { return call("console.logs"); },
      command: function (command) { return call("console.command", { command: command }); },
      subscribe: subscribeConsole,
      run: runCommand,
      /** Current stream state: "closed", "connecting", "attached" or "reconnecting". */
      get state() { return consoleState; },
      stripAnsi: stripAnsi,
    },
    files: {
      list: function (path) { return call("files.list", { path: path || "/" }); },
      read: function (path) { return call("files.read", { path: path }); },
      write: function (path, content) { return call("files.write", { path: path, content: content }); },
    },
    ui: {
      toast: function (message, variant) { return call("ui.toast", { message: message, variant: variant || "info" }); },
      /** Open another page of the same server, e.g. "console" or "files". */
      navigate: function (section) { return call("ui.navigate", { section: section }); },
    },
  };

  window.Flutter = Flutter;
  post({ type: "hello", apiVersion: API_VERSION });
})();
`;
