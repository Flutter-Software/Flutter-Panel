//! Rust bindings for the Flutter Panel extension SDK.
//!
//! Extensions run in a sandboxed iframe. The panel injects a JavaScript SDK
//! (`window.Flutter`) that bridges to the panel; this crate wraps it so a
//! Rust extension compiled to WebAssembly (wasm-bindgen) can use it with
//! normal Rust types and `async`/`await`.
//!
//! ```no_run
//! use flutter_extension as flutter;
//! use wasm_bindgen::prelude::*;
//!
//! #[wasm_bindgen(start)]
//! pub fn start() {
//!     wasm_bindgen_futures::spawn_local(async {
//!         let ctx = flutter::ready().await.unwrap();
//!         flutter::ui::toast(&format!("Hello from {}", ctx.server.name), flutter::ui::Toast::Success);
//!     });
//! }
//! ```
//!
//! Every call the panel answers is subject to the permissions an admin
//! approved for the extension, plus the viewer's own server permissions.
//! Failures surface as [`Error`].
//!
//! Requires the page to have loaded `/api/v1/extensions/sdk.js`, which the
//! panel does automatically for `.wasm` entries.

use js_sys::{Array, Function, Object, Promise, Reflect};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;

/* -------------------------------------------------------------------------- */
/*                                  JS imports                                */
/* -------------------------------------------------------------------------- */

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = Flutter, js_name = ready)]
    fn js_ready() -> Promise;

    #[wasm_bindgen(js_namespace = Flutter, js_name = call)]
    fn js_call(method: &str, params: &JsValue) -> Promise;

    #[wasm_bindgen(js_namespace = Flutter, js_name = on)]
    fn js_on(event: &str, callback: &Function) -> Function;

    #[wasm_bindgen(js_namespace = ["Flutter", "console"], js_name = subscribe)]
    fn js_console_subscribe(handlers: &Object) -> JsValue;

    #[wasm_bindgen(js_namespace = ["Flutter", "console"], js_name = run)]
    fn js_console_run(command: &str, options: &Object) -> Promise;

    #[wasm_bindgen(js_namespace = ["Flutter", "console"], js_name = stripAnsi)]
    fn js_strip_ansi(line: &str) -> String;
}

/* -------------------------------------------------------------------------- */
/*                                    Errors                                  */
/* -------------------------------------------------------------------------- */

/// A failed SDK call: missing permission, no access, API error, timeout...
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error(pub String);

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

impl From<JsValue> for Error {
    fn from(value: JsValue) -> Self {
        if let Some(err) = value.dyn_ref::<js_sys::Error>() {
            return Error(String::from(err.message()));
        }
        Error(value.as_string().unwrap_or_else(|| format!("{value:?}")))
    }
}

impl From<serde_wasm_bindgen::Error> for Error {
    fn from(value: serde_wasm_bindgen::Error) -> Self {
        Error(format!("Unexpected response shape: {value}"))
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/* -------------------------------------------------------------------------- */
/*                                    Types                                   */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Usage {
    pub used: f64,
    pub limit: f64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MemoryUsage {
    pub used_mb: f64,
    pub limit_mb: f64,
}

/// The server the page is open on. Without the `server.read` permission only
/// `id` is filled in.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Server {
    pub id: String,
    pub uuid: Option<String>,
    pub name: String,
    pub description: String,
    /// "offline", "starting", "running", "stopping", "installing", ...
    pub status: String,
    pub egg: String,
    pub node: String,
    pub node_location: Option<String>,
    pub allocation: String,
    pub uptime: String,
    pub cpu: Usage,
    pub memory: MemoryUsage,
    pub disk: MemoryUsage,
}

impl Server {
    pub fn is_running(&self) -> bool {
        self.status == "running"
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExtensionInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub permissions: Vec<String>,
    /// Id of the server page being shown.
    pub page: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct User {
    pub id: String,
    pub username: String,
    pub admin: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Theme {
    /// "light" or "dark". The SDK has already applied the panel's CSS variables.
    pub mode: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Context {
    pub api_version: u32,
    pub extension: ExtensionInfo,
    pub server: Server,
    pub user: Option<User>,
    pub theme: Theme,
}

/* -------------------------------------------------------------------------- */
/*                                    Core                                    */
/* -------------------------------------------------------------------------- */

async fn await_promise(promise: Promise) -> Result<JsValue> {
    JsFuture::from(promise).await.map_err(Error::from)
}

/// Calls any bridge method by name and deserializes the result.
pub async fn call<T: DeserializeOwned>(method: &str, params: impl Serialize) -> Result<T> {
    let params = serde_wasm_bindgen::to_value(&params)?;
    let value = await_promise(js_call(method, &params)).await?;
    Ok(serde_wasm_bindgen::from_value(value)?)
}

/// Like [`call`], for methods whose result you don't need.
pub async fn call_unit(method: &str, params: impl Serialize) -> Result<()> {
    let params = serde_wasm_bindgen::to_value(&params)?;
    await_promise(js_call(method, &params)).await.map(|_| ())
}

/// Waits for the panel handshake and returns the page context.
pub async fn ready() -> Result<Context> {
    let value = await_promise(js_ready()).await?;
    Ok(serde_wasm_bindgen::from_value(value)?)
}

/// Keeps a JS callback alive; dropping it unsubscribes.
pub struct Listener {
    unsubscribe: Option<Function>,
    _closure: Box<dyn std::any::Any>,
}

impl Listener {
    /// Keep listening for the rest of the page's life.
    pub fn forget(mut self) {
        self.unsubscribe = None;
        std::mem::forget(self);
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        if let Some(unsubscribe) = self.unsubscribe.take() {
            let _ = unsubscribe.call0(&JsValue::NULL);
        }
    }
}

/// Called whenever the panel's record of this server changes (status, name,
/// usage...). Requires `server.read`.
pub fn on_server(mut callback: impl FnMut(Server) + 'static) -> Listener {
    let closure = Closure::<dyn FnMut(JsValue)>::new(move |value: JsValue| {
        if let Ok(server) = serde_wasm_bindgen::from_value::<Server>(value) {
            callback(server);
        }
    });
    let unsubscribe = js_on("server", closure.as_ref().unchecked_ref());
    Listener { unsubscribe: Some(unsubscribe), _closure: Box::new(closure) }
}

/* -------------------------------------------------------------------------- */
/*                                   Server                                   */
/* -------------------------------------------------------------------------- */

pub mod server {
    use super::*;

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Power {
        Start,
        Stop,
        Restart,
        Kill,
    }

    impl Power {
        fn as_str(self) -> &'static str {
            match self {
                Power::Start => "start",
                Power::Stop => "stop",
                Power::Restart => "restart",
                Power::Kill => "kill",
            }
        }
    }

    #[derive(Serialize)]
    struct Empty {}

    /// Current server record. Requires `server.read`.
    pub async fn get() -> Result<Server> {
        call("server.get", Empty {}).await
    }

    /// Requires `power`, and the viewer needs the matching control permission.
    pub async fn power(action: Power) -> Result<()> {
        #[derive(Serialize)]
        struct Params<'a> {
            action: &'a str,
        }
        call_unit("server.power", Params { action: action.as_str() }).await
    }
}

/* -------------------------------------------------------------------------- */
/*                                   Console                                  */
/* -------------------------------------------------------------------------- */

pub mod console {
    use super::*;

    #[derive(Debug, Clone, Default, Deserialize)]
    pub struct Logs {
        pub running: bool,
        pub lines: Vec<String>,
    }

    #[derive(Serialize)]
    struct Empty {}

    /// Snapshot of the last ~200 lines. Prefer [`subscribe`] for live output.
    pub async fn logs() -> Result<Logs> {
        call("console.logs", Empty {}).await
    }

    /// Fire-and-forget command. Use [`run`] when you need the reply.
    pub async fn command(command: &str) -> Result<()> {
        #[derive(Serialize)]
        struct Params<'a> {
            command: &'a str,
        }
        call_unit("console.command", Params { command }).await
    }

    /// Removes ANSI colour codes.
    pub fn strip_ansi(line: &str) -> String {
        js_strip_ansi(line)
    }

    /// Stream connection state; the panel reconnects on its own.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum State {
        Connecting,
        Attached,
        Reconnecting,
        Closed,
    }

    impl State {
        fn parse(value: &str) -> State {
            match value {
                "attached" => State::Attached,
                "reconnecting" => State::Reconnecting,
                "connecting" => State::Connecting,
                _ => State::Closed,
            }
        }
    }

    type LineFn = Box<dyn FnMut(String, String)>;
    type HistoryFn = Box<dyn FnMut(Vec<String>)>;
    type StateFn = Box<dyn FnMut(State, u32)>;
    type StatusFn = Box<dyn FnMut(String)>;

    /// Builder for a live console subscription. See [`subscribe`].
    #[derive(Default)]
    pub struct Subscribe {
        on_line: Option<LineFn>,
        on_history: Option<HistoryFn>,
        on_state: Option<StateFn>,
        on_status: Option<StatusFn>,
    }

    /// Starts building a live console subscription. The panel keeps the stream
    /// attached (reconnects, server restarts, sleeping tabs) for as long as the
    /// returned [`Subscription`] is alive. Requires `console.read`.
    ///
    /// ```no_run
    /// let sub = flutter_extension::console::subscribe()
    ///     .on_line(|_raw, plain| web_sys::console::log_1(&plain.into()))
    ///     .start();
    /// sub.forget(); // keep it for the page's lifetime
    /// ```
    pub fn subscribe() -> Subscribe {
        Subscribe::default()
    }

    impl Subscribe {
        /// `(raw, plain)`: raw keeps colour codes, plain has them stripped.
        pub fn on_line(mut self, f: impl FnMut(String, String) + 'static) -> Self {
            self.on_line = Some(Box::new(f));
            self
        }
        /// Recent backlog, sent on every (re)attach.
        pub fn on_history(mut self, f: impl FnMut(Vec<String>) + 'static) -> Self {
            self.on_history = Some(Box::new(f));
            self
        }
        pub fn on_state(mut self, f: impl FnMut(State, u32) + 'static) -> Self {
            self.on_state = Some(Box::new(f));
            self
        }
        /// Server process status changes ("running", "offline", ...).
        pub fn on_status(mut self, f: impl FnMut(String) + 'static) -> Self {
            self.on_status = Some(Box::new(f));
            self
        }

        pub fn start(self) -> Subscription {
            let handlers = Object::new();
            let mut closures: Vec<Box<dyn std::any::Any>> = Vec::new();

            if let Some(mut f) = self.on_line {
                let c = Closure::<dyn FnMut(String, String)>::new(move |raw, plain| f(raw, plain));
                let _ = Reflect::set(&handlers, &"onLine".into(), c.as_ref());
                closures.push(Box::new(c));
            }
            if let Some(mut f) = self.on_history {
                let c = Closure::<dyn FnMut(JsValue)>::new(move |lines: JsValue| {
                    let lines = Array::from(&lines).iter().filter_map(|line| line.as_string()).collect();
                    f(lines)
                });
                let _ = Reflect::set(&handlers, &"onHistory".into(), c.as_ref());
                closures.push(Box::new(c));
            }
            if let Some(mut f) = self.on_state {
                let c = Closure::<dyn FnMut(String, u32)>::new(move |state: String, attempt| {
                    f(State::parse(&state), attempt)
                });
                let _ = Reflect::set(&handlers, &"onState".into(), c.as_ref());
                closures.push(Box::new(c));
            }
            if let Some(mut f) = self.on_status {
                let c = Closure::<dyn FnMut(String)>::new(move |status| f(status));
                let _ = Reflect::set(&handlers, &"onStatus".into(), c.as_ref());
                closures.push(Box::new(c));
            }

            let handle = js_console_subscribe(&handlers);
            Subscription { handle: Some(handle), _closures: closures }
        }
    }

    /// Live console subscription. Dropping it closes the stream (once the
    /// last subscriber on the page is gone).
    pub struct Subscription {
        handle: Option<JsValue>,
        _closures: Vec<Box<dyn std::any::Any>>,
    }

    impl Subscription {
        /// Resolves once the stream is attached the first time.
        pub async fn ready(&self) -> Result<()> {
            let handle = self.handle.as_ref().ok_or_else(|| Error("Subscription closed".into()))?;
            let promise: Promise = Reflect::get(handle, &"ready".into())?.unchecked_into();
            await_promise(promise).await.map(|_| ())
        }

        /// Keep the subscription for the rest of the page's life.
        pub fn forget(mut self) {
            self.handle = None;
            std::mem::forget(self);
        }
    }

    impl Drop for Subscription {
        fn drop(&mut self) {
            if let Some(handle) = self.handle.take() {
                if let Ok(close) = Reflect::get(&handle, &"close".into()) {
                    if let Some(close) = close.dyn_ref::<Function>() {
                        let _ = close.call0(&handle);
                    }
                }
            }
        }
    }

    /// Options for [`run`].
    #[derive(Debug, Clone, Default)]
    pub struct RunOptions {
        /// JavaScript regular expression source, matched against plain lines.
        pub pattern: Option<String>,
        /// Regex flags, e.g. "i".
        pub flags: String,
        /// With a pattern: give up after this many ms (default 5000).
        pub timeout_ms: Option<u32>,
        /// Without a pattern: collect output for this many ms (default 750).
        pub settle_ms: Option<u32>,
    }

    impl RunOptions {
        /// Wait for the first line matching `pattern` (JavaScript regex syntax).
        pub fn matching(pattern: &str) -> Self {
            RunOptions { pattern: Some(pattern.to_owned()), ..Default::default() }
        }
        /// Collect every line printed within `ms` after sending.
        pub fn settle(ms: u32) -> Self {
            RunOptions { settle_ms: Some(ms), ..Default::default() }
        }
        pub fn flags(mut self, flags: &str) -> Self {
            self.flags = flags.to_owned();
            self
        }
        pub fn timeout(mut self, ms: u32) -> Self {
            self.timeout_ms = Some(ms);
            self
        }
    }

    /// Result of [`run`].
    #[derive(Debug, Clone, Default)]
    pub struct RunOutput {
        /// Matching line with colour codes (pattern mode).
        pub line: Option<String>,
        /// Matching line without colour codes (pattern mode).
        pub plain: Option<String>,
        /// Capture groups; index 0 is the whole match (pattern mode).
        pub captures: Vec<Option<String>>,
        /// Every plain line seen after sending.
        pub lines: Vec<String>,
    }

    /// Sends a command and collects its reply from the live stream. Attaches
    /// before sending so a fast reply can't be missed. Requires
    /// `console.read` and `console.command`.
    pub async fn run(command: &str, options: RunOptions) -> Result<RunOutput> {
        let opts = Object::new();
        if let Some(pattern) = &options.pattern {
            let regex = js_sys::RegExp::new(pattern, &options.flags);
            Reflect::set(&opts, &"match".into(), &regex)?;
        }
        if let Some(timeout) = options.timeout_ms {
            Reflect::set(&opts, &"timeout".into(), &JsValue::from(timeout))?;
        }
        if let Some(settle) = options.settle_ms {
            Reflect::set(&opts, &"settle".into(), &JsValue::from(settle))?;
        }

        let value = await_promise(js_console_run(command, &opts)).await?;
        let get_string = |key: &str| Reflect::get(&value, &key.into()).ok().and_then(|v| v.as_string());
        let lines = Reflect::get(&value, &"lines".into())
            .map(|v| Array::from(&v).iter().filter_map(|line| line.as_string()).collect())
            .unwrap_or_default();
        let captures = Reflect::get(&value, &"match".into())
            .ok()
            .filter(|v| Array::is_array(v))
            .map(|v| Array::from(&v).iter().map(|group| group.as_string()).collect())
            .unwrap_or_default();

        Ok(RunOutput { line: get_string("line"), plain: get_string("plain"), captures, lines })
    }
}

/* -------------------------------------------------------------------------- */
/*                                    Files                                   */
/* -------------------------------------------------------------------------- */

pub mod files {
    use super::*;

    #[derive(Debug, Clone, Default, Deserialize)]
    #[serde(rename_all = "camelCase", default)]
    pub struct Entry {
        pub name: String,
        /// "file" or "dir".
        pub kind: String,
        pub size: u64,
        pub modified_at: String,
    }

    #[derive(Debug, Clone, Default, Deserialize)]
    #[serde(default)]
    pub struct Listing {
        pub path: String,
        pub entries: Vec<Entry>,
    }

    #[derive(Debug, Clone, Default, Deserialize)]
    #[serde(default)]
    pub struct File {
        pub path: String,
        pub content: String,
    }

    #[derive(Serialize)]
    struct PathParams<'a> {
        path: &'a str,
    }

    /// Requires `files.read`.
    pub async fn list(path: &str) -> Result<Listing> {
        call("files.list", PathParams { path }).await
    }

    /// Requires `files.read`.
    pub async fn read(path: &str) -> Result<File> {
        call("files.read", PathParams { path }).await
    }

    /// Creates missing folders. Requires `files.write`.
    pub async fn write(path: &str, content: &str) -> Result<()> {
        #[derive(Serialize)]
        struct Params<'a> {
            path: &'a str,
            content: &'a str,
        }
        call_unit("files.write", Params { path, content }).await
    }
}

/* -------------------------------------------------------------------------- */
/*                                     UI                                     */
/* -------------------------------------------------------------------------- */

pub mod ui {
    use super::*;

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Toast {
        Info,
        Success,
        Warning,
        Error,
    }

    /// Shows a panel toast. Fire-and-forget.
    pub fn toast(message: &str, variant: Toast) {
        #[derive(Serialize)]
        struct Params<'a> {
            message: &'a str,
            variant: &'a str,
        }
        let variant = match variant {
            Toast::Info => "info",
            Toast::Success => "success",
            Toast::Warning => "warning",
            Toast::Error => "error",
        };
        if let Ok(params) = serde_wasm_bindgen::to_value(&Params { message, variant }) {
            let _ = js_call("ui.toast", &params);
        }
    }

    /// Opens another page of the same server, e.g. "console" or "files?path=/logs".
    pub async fn navigate(section: &str) -> Result<()> {
        #[derive(Serialize)]
        struct Params<'a> {
            section: &'a str,
        }
        call_unit("ui.navigate", Params { section }).await
    }
}
