# Flutter Panel extensions

Extensions add your own pages and tools to the panel, for example a player list for Minecraft servers, a map viewer, or a mod manager. They're built into the panel, so there's nothing to patch and no rebuild. An extension is a folder with a manifest and one of:

- **Plain HTML/JS**, with no tooling at all.
- **TypeScript**, with or without React. The panel compiles it for you, so there's no build step.
- **Rust (WebAssembly)**: you build a `.wasm` with wasm-bindgen; the panel loads and starts it.

## Templates

Starters aren't shipped with the panel. Download them from the docs: **https://docs.flutter.software/extensions/templates**

| Template | Entry | Use it when | Build step |
|---|---|---|---|
| `html-starter` | `index.html` | You want plain HTML/CSS/JS, or to drop in your own bundler output | none |
| `typescript-starter` | `src/main.ts` | You want TypeScript without a framework | none (the panel compiles) |
| `react-starter` | `src/main.tsx` | You want React components and hooks | none (the panel compiles) |
| `rust-starter` | `pkg/rust_starter_bg.wasm` | You want Rust (or Yew/Leptos/Dioxus) | `build.ps1` / `build.sh` |

They all build the same page (server header, usage cards, live console with a Live/Reconnecting badge, and a command box). Each zip is one folder that's self-contained (it includes `flutter-sdk.d.ts` or the `flutter-extension` crate it needs) and can be uploaded unchanged. Rename the folder and change `id` and `name` in `extension.json` (the folder name must match `id`).

What stays in this folder:

```
extensions/
  flutter-sdk.d.ts               ← editor types for window.Flutter
  _sdk/rust/flutter-extension/   ← Rust bindings for window.Flutter (folders starting with _ aren't extensions)
  <your extensions>/             ← git-ignored, survive panel updates
```

## Install, enable, update

**From a .zip (easiest):** open **Admin → Extensions**, press **Upload .zip** and pick the archive. Then review the permissions and enable it.

- `extension.json` can sit at the top of the zip or inside one top-level folder, which is what "Compress folder" produces.
- Limits: 50 MB zip, 200 MB unpacked, 5,000 files. `__MACOSX/`, `.DS_Store` and `Thumbs.db` are skipped. Paths that escape the folder are rejected.
- The upload is unpacked into a hidden staging folder, checked, then swapped in. A broken zip never leaves a half-installed extension.

**From a folder:** copy the folder into this directory and press **Rescan**. The folder name must equal the manifest `id`. Set `EXTENSIONS_DIR` to use a different location.

Once enabled, the extension's pages show up in the sidebar of every server it targets.

- **Update:** upload a zip of the new version (you'll be asked to confirm the replace), or replace the files and press **Rescan**. If the new version asks for permissions you haven't granted, it switches to **Needs approval** and stops being served until you approve it.
- **Share or back up:** the download button on each row exports the extension as a `.zip` (without `node_modules`).
- **Uninstall:** the bin button deletes the folder and its approval. Download it first if you want a copy.

Folders starting with `.` or `_` are ignored, so `_drafts/` is a handy place to work on something that isn't ready. Extensions you add yourself are git-ignored and survive panel updates.

## Manifest: `extension.json`

```jsonc
{
  "id": "player-list",                // a-z, 0-9, dashes; 2-48 chars; equals the folder name
  "name": "Player List",
  "version": "1.0.0",                 // semver
  "description": "Short summary shown to admins.",
  "author": "You",
  "homepage": "https://example.com",  // optional
  "icon": "users",                    // see Icons below
  "permissions": ["server.read", "console.read", "console.command", "files.read"],

  // Optional. Omit to appear on every server. `*` is a wildcard, case-insensitive.
  // The extension shows if the egg name OR the docker image matches.
  "targets": {
    "eggs": ["*minecraft*", "*paper*"],
    "dockerImages": ["*minecraft*"]
  },

  "contributes": {
    "serverPages": [                  // up to 8
      {
        "id": "players",              // a-z, 0-9, dashes; becomes /server/:id/ext/<ext>/<page>
        "label": "Players",           // sidebar label, max 24 chars
        "icon": "users",
        "entry": "src/main.tsx",      // .tsx/.ts/.jsx/.js/.mjs (compiled), .wasm (Rust), or .html
        "permission": "control.console" // optional: hide from viewers without this server permission
      }
    ]
  }
}
```

Admin → Extensions shows any validation errors next to the extension.

### Icons

`puzzle` `users` `user` `gamepad` `chart` `map` `shield` `terminal` `globe` `package` `zap` `settings` `list` `box` `book` `bell` `heart` `star` `clock` `database`

## Permissions

An extension can only use the bridge methods its approved permissions cover. On top of that, the panel makes every call **as the person viewing the page**, so their own server permissions still apply. A subuser without console access can't send commands through an extension either.

| Permission | Unlocks | Viewer also needs |
|---|---|---|
| `server.read` | `Flutter.server.get()` and the full `context.server` | none |
| `console.read` | `Flutter.console.logs()`, `subscribe()`, `run()` (with `console.command`) | `control.console` |
| `console.command` | `Flutter.console.command()` | `control.console` |
| `files.read` | `Flutter.files.list()`, `Flutter.files.read()` | `file.read` |
| `files.write` | `Flutter.files.write()` | `file.write` |
| `power` | `Flutter.server.power()` | `control.start` / `stop` / `restart` |

Without `server.read`, `context.server` contains only `{ id }`.

## The page

Each server page is rendered in a **sandboxed iframe** inside the server view. Its `entry` can be a script or an HTML file.

### TypeScript / React (`.tsx`, `.ts`, `.jsx`)

Point `entry` at a script. The panel serves a page that already has the SDK loaded and a `<div id="root">`, and bundles your script with esbuild when it's requested:

- **TypeScript and JSX**, using the automatic runtime, so no `import React` is needed.
- **Imports** of your own files, plus `import "./style.css"`, which is injected as a `<style>` tag.
- **Images, fonts and JSON**: `import logo from "./logo.png"` gives a data URL; `.json` and `.txt` import as data.
- **npm packages**: `react` and `react-dom` come from the panel, so nothing needs installing. For anything else, run `npm install` inside your extension folder; its `node_modules` takes priority.
- **Not type-checked at runtime.** esbuild strips types without checking them. Use your editor or `npx tsc -p <folder>` (see `tsconfig.json` in the React template).

```tsx
// src/main.tsx
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";

function App() {
  const [name, setName] = useState("…");
  useEffect(() => {
    Flutter.ready().then(({ server }) => setName(server.name));
  }, []);
  return <h1>Hello from {name}</h1>;
}

createRoot(document.getElementById("root")!).render(<App />);
```

For editor autocompletion, add `/// <reference path="../../flutter-sdk.d.ts" />` at the top of a file (the templates ship their own copy, so they use `../flutter-sdk.d.ts`), or include it in your tsconfig. The React template's `src/hooks.ts` has ready-made `useFlutter()` and `useConsole()` hooks.

If the build fails, the error and its file:line show up inside the page. Fix the file and reload. Bundles are cached until one of their input files changes. Imports from outside your extension folder (or the allowed `node_modules`) are blocked, because compiled output is served publicly.

You can also reference a `.tsx`/`.ts` file directly from your own HTML with `<script type="module" src="app.tsx">`. It's compiled the same way.

### Rust (WebAssembly)

Write the extension in Rust, compile it to WebAssembly with [wasm-bindgen](https://rustwasm.github.io/docs/wasm-bindgen/), and point `entry` at the `.wasm` file:

```jsonc
{ "id": "main", "label": "My Rust Page", "entry": "pkg/my_extension_bg.wasm" }
```

The panel serves a page with the SDK and a `<div id="root">`. It loads the wasm through the JS glue file wasm-bindgen generates next to it (`pkg/my_extension_bg.wasm` → `pkg/my_extension.js`) and starts it:

- A `#[wasm_bindgen(start)]` function runs automatically.
- Otherwise the panel calls an exported `main`, `start` or `run`. Use one or the other, not both.
- If it fails to start, the error appears in the page.

The panel doesn't compile Rust. Building would mean running arbitrary `build.rs` and proc-macro code on the panel host, outside the sandbox. You build locally and ship the `pkg/` output, so admins only ever run sandboxed WebAssembly.

**One-time setup:**

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.130   # must equal the wasm-bindgen version in Cargo.toml
```

**Build** (the `rust-starter` template ships these two commands as `build.sh` / `build.ps1`):

```sh
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --target web --no-typescript --out-dir pkg target/wasm32-unknown-unknown/release/<crate>.wasm
```

`wasm-pack build --target web --out-dir pkg` works too. Use `--target web` either way, because the panel loads the glue as an ES module.

**The `flutter-extension` crate** (`_sdk/rust/flutter-extension`) wraps the SDK with Rust types and `async`:

```rust
use flutter_extension::{self as flutter, console, files, ui};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn start() {
    wasm_bindgen_futures::spawn_local(async {
        let ctx = flutter::ready().await.unwrap();                      // Context { server, user, extension, theme }
        ui::toast(&format!("Hi {}", ctx.server.name), ui::Toast::Success);

        // Live console, kept attached by the panel. Dropping the handle closes it; .forget() keeps it.
        console::subscribe().on_line(|_raw, plain| { /* … */ }).start().forget();

        // Command + reply: captures[n] are the regex groups.
        let reply = console::run("list", console::RunOptions::matching(r"There are (\d+) of a max")).await?;

        let props = files::read("server.properties").await?;            // { path, content }
        flutter::on_server(|server| { /* status changed */ }).forget();
        Ok::<_, flutter::Error>(())
    });
}
```

| Rust | JS equivalent |
|---|---|
| `flutter::ready()`, `flutter::on_server(f)` | `Flutter.ready()`, `Flutter.on("server", f)` |
| `flutter::server::get()`, `server::power(Power::Restart)` | `Flutter.server.get()`, `.power("restart")` |
| `console::logs()`, `console::command(c)` | `Flutter.console.logs()`, `.command(c)` |
| `console::subscribe().on_line(..).on_history(..).on_state(..).on_status(..).start()` | `Flutter.console.subscribe({...})` |
| `console::run(c, RunOptions::matching(re).timeout(ms))` / `RunOptions::settle(ms)` | `Flutter.console.run(c, {...})` |
| `files::list(p)`, `files::read(p)`, `files::write(p, s)` | `Flutter.files.*` |
| `ui::toast(msg, Toast::Info)`, `ui::navigate("console")` | `Flutter.ui.*` |
| `flutter::call::<T>(method, params)` | `Flutter.call(method, params)` |

Use `web-sys` for the DOM, or a Rust UI framework built on wasm-bindgen (Yew, Leptos, Dioxus), rendering into `#root`. Theme colours are available as CSS variables (see Theming).

**Shipping:** zip the folder **with `pkg/`**. `target/` can stay out; the download button skips it. Keep a Rust extension's own folder small: assets are capped at 32 MB each, and a small release build is around 150 KB.

### Plain HTML

Point `entry` at an `.html` file. Load the SDK yourself, then wait for the handshake:

```html
<!doctype html>
<html>
  <head>
    <script src="/api/v1/extensions/sdk.js"></script>
  </head>
  <body>
    <h1 id="title">Loading…</h1>
    <script>
      Flutter.ready().then(function (ctx) {
        document.getElementById("title").textContent = "Hello from " + ctx.server.name;
      });
    </script>
  </body>
</html>
```

Relative URLs (`app.js`, `style.css`, `img/logo.png`) load from your extension folder. Plain `.js` is served as-is. Your own bundler output works too: point `entry` at the built HTML.

## SDK reference: `window.Flutter`

Every method returns a Promise. A method rejects with an `Error` if the permission is missing, the viewer lacks access, or the API call fails.

| Call | Returns |
|---|---|
| `Flutter.ready()` | context: `{ apiVersion, extension, server, user, theme }` |
| `Flutter.context` | the same object, or `null` before ready |
| `Flutter.on(event, fn)` | an unsubscribe function. Events: `"init"`, `"server"` (record changed: status, name…), `"theme"` |
| `Flutter.server.get()` | `{ id, uuid, name, description, status, egg, node, nodeLocation, allocation, uptime, cpu, memory, disk }` |
| `Flutter.server.power(action)` | `"start"`, `"stop"`, `"restart"` or `"kill"` |
| `Flutter.console.logs()` | `{ running, lines: string[] }`, a one-off snapshot of the last ~200 lines |
| `Flutter.console.command(cmd)` | `{ ok: true }`. Fire and forget; use `run()` when you need the reply |
| `Flutter.console.run(cmd, { match, timeout, settle })` | sends `cmd` and resolves with its output from the live stream. See below |
| `Flutter.console.subscribe({ onLine, onHistory, onState, onStatus })` | `{ ready, close() }`. Keeps a live console stream attached. See below |
| `Flutter.console.state` | `"closed"`, `"connecting"`, `"attached"` or `"reconnecting"` |
| `Flutter.console.stripAnsi(line)` | the line without colour codes |
| `Flutter.files.list(path)` | `{ path, entries: [{ name, kind, size, modifiedAt, … }] }` |
| `Flutter.files.read(path)` | `{ path, content }` |
| `Flutter.files.write(path, content)` | `{ path, size }`. Missing folders are created |
| `Flutter.ui.toast(message, variant)` | shows a panel toast. Variants: `"info"`, `"success"`, `"warning"`, `"error"` |
| `Flutter.ui.navigate(section)` | opens another page of the same server, e.g. `"console"` or `"files?path=/logs"` |
| `Flutter.call(method, params)` | low-level form of the calls above |

## Keeping the console attached

Your extension never opens a websocket itself. The **panel owns the console connection** and keeps it attached for you while at least one subscription is open. It re-attaches automatically when:

- the network drops or the API restarts (it retries, backing off up to 5 s);
- the server restarts and the daemon closes the stream;
- the tab comes back from the background or the machine wakes from sleep;
- the stream goes silent for 20 s while the server is running, which means the pipe is dead rather than quiet.

```js
const live = Flutter.console.subscribe({
  onLine(raw, plain) { /* raw keeps colour codes, plain is stripped */ },
  onHistory(lines) { /* recent backlog, sent on every (re)attach */ },
  onState(state, attempt) { /* "connecting" | "attached" | "reconnecting" | "closed" */ },
  onStatus(status) { /* "running", "offline", ... */ },
});
await live.ready;  // attached at least once
live.close();      // the stream closes when the last subscriber closes
```

Rules of thumb:

- **Need a command's reply? Use `run()`.** It attaches *before* sending, so a fast reply can't slip past, and it cleans up afterwards:
  ```js
  const reply = await Flutter.console.run("list", {
    match: /There are (\d+) of a max of (\d+) players online/,  // or a function(plainLine)
    timeout: 5000,                                               // reject if no match in time
  });
  reply.match[1]; // "3"
  // No `match`: resolves with { lines } seen within `settle` ms (default 750).
  ```
- **Long-lived view? `subscribe()` once at start-up** and keep it open while the page is shown. Re-fetch your data when `onState` reports `"attached"` again, because anything printed while the stream was down is only in the history backlog.
- Don't poll `console.logs()` in a loop. It's a snapshot, not a stream, and it misses lines between polls.
- Subscriptions are shared. Several `subscribe()`/`run()` calls use one connection, and reloading the page drops them all.
- Streams require the `console.read` permission. The viewer also needs `control.console` on the server.

Every template uses both: a long-lived `subscribe()` that renders the console and the Live / Reconnecting badge, and `run()` for the command box. For a game-specific example, `run("list", { match: /There are (\d+) of a max of (\d+) players online:?\s*(.*)$/ })` gives you a Minecraft server's player count and names.

## Theming

The SDK copies the panel's colour tokens onto your page's `:root` and keeps them updated when the user switches theme. It also sets `data-theme="light|dark"` and `color-scheme` on `<html>`.

```css
body   { background: var(--card); color: var(--foreground); }
.muted { color: var(--muted-foreground); }
.btn   { background: var(--primary); color: var(--primary-foreground); border-radius: var(--radius-md); }
```

Available: `--background --foreground --card --card-foreground --popover --popover-foreground --primary --primary-foreground --secondary --secondary-foreground --muted --muted-foreground --accent --accent-foreground --destructive --destructive-foreground --border --input --ring --status-running --status-warn --status-error --status-info --status-offline --radius-sm --radius-md --radius-lg`

## Code scan

Every installed extension is scanned automatically. The result shows as a badge on its row in Admin → Extensions: **Low risk**, **Review advised** or **High risk**. Click the badge for the full report. The enable/approve dialog shows a summary, and a **High risk** result needs an extra "I've reviewed this" tick before it can be enabled.

The scan reads your source, HTML and compiled `.wasm` (its imports), and reports:

| Severity | Examples |
|---|---|
| High | `eval` / `new Function`, scripts loaded from the internet, touching `window.top`, miner signatures, being able to change servers while also contacting outside hosts |
| Medium | network calls to outside domains (listed by name), remote images/fonts/styles, obfuscated code, WebAssembly shipped without its source |
| Low | permissions requested but apparently unused, minified files, `document.cookie` |
| Info | console commands it sends (e.g. `op`, `ban`), files it writes, SDK calls missing a permission |

To keep your extension at **Low risk**: ship readable source (include `src/*.rs` next to `pkg/` for Rust), don't load code from CDNs (bundle it, which TSX entries do for you), request only the permissions you use, and avoid `eval`.

The scan is pattern-based. It can miss things and flag harmless code, and it doesn't scan `node_modules` or `target`. Reports are cached and re-run whenever a file changes, or when you press **Rescan**.

## Security model

- The iframe is sandboxed **without** `allow-same-origin`, so the page has an opaque origin. It can't read the panel's cookies or call `/api` as the user. Every capability goes through the bridge.
- Extension files are also served with a `Content-Security-Policy: sandbox` header, so opening an asset URL directly is sandboxed too.
- Files are served only while the extension is enabled. They're public to anyone who knows the URL, so don't put secrets in them.
- Enabling an extension and approving permissions requires a signed-in admin. API keys can't do it.
- `fetch()` to outside services works (CORS rules apply), but those requests don't carry the user's panel session.

## Development loop

1. Create the folder and manifest (or start from a downloaded template), then Rescan and enable once.
2. Edit TSX/HTML/JS/CSS and reload the page. Files are read from disk, and TSX is rebuilt whenever an input file changes.
3. Manifest edits are picked up within about 10 seconds, or straight away when you press Rescan.
4. Rust: rerun `build.ps1`/`build.sh` and reload. The page always fetches the latest `pkg/`.
5. To ship it, zip the folder (skip `node_modules` and `target`, keep Rust's `pkg/`), or use the download button in Admin → Extensions.

## Roadmap

These aren't available yet:

- Installing from a URL or an extension catalogue
- More contribution points: admin pages, dashboard widgets, buttons on the server card and header
- Per-extension settings and storage
- Server-side hooks (react to server start/stop, schedule tasks)
- Choosing which servers or users get an extension, beyond `targets`
