/**
 * On-the-fly compiler for extension source files.
 *
 * When a sandboxed extension page requests a `.tsx` / `.ts` / `.jsx` file (or
 * any script with `?build=1`), it is bundled with esbuild:
 *  - TypeScript and JSX (automatic runtime, so no `import React` needed)
 *  - relative imports and `.css` imports (injected as <style> tags)
 *  - npm packages from the extension's own `node_modules`, falling back to
 *    the panel's (so `react`, `react-dom` and `svelte` work with no install step)
 *  - Svelte 5: `.svelte` components (including `<script lang="ts">`) and
 *    `.svelte.ts` / `.svelte.js` rune modules, compiled by the panel's
 *    `svelte/compiler`. A `.svelte` page entry is mounted into `#root`.
 *
 * Results are cached per file and reused until any input file's mtime
 * changes, so editing a file and reloading the page is enough during
 * development.
 *
 * Bundling is confined to the extension folder and the allowed node_modules
 * directories. Compiled output is served publicly, so an extension must not be
 * able to pull e.g. `../../apps/daemon/data/config.json` into its bundle.
 */
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { build, transform, type BuildOptions, type Message, type PartialMessage, type Plugin } from "esbuild";
import { compile as compileSvelte, compileModule as compileSvelteModule } from "svelte/compiler";

type CacheEntry = { code: string; inputs: Map<string, number> };

/**
 * How a file is turned into a module:
 *  - `module`: bundle the file as-is (its exports stay exports).
 *  - `mount`: the file is a `.svelte` page entry; bundle a tiny wrapper that
 *    imports it and mounts it into `#root`, so the generated page just works.
 */
export type ExtensionBuildMode = "module" | "mount";

/** Keyed by `<mode>:<absolute file>`; see `cacheKey`. */
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string>>();

/** Panel-level node_modules extensions may import from (react, react-dom, ...). */
function panelNodeModules() {
  return [resolve(process.cwd(), "node_modules"), resolve(process.cwd(), "../../node_modules")];
}

function inside(root: string, file: string) {
  const base = root.endsWith(sep) ? root : root + sep;
  return file === root || file.startsWith(base);
}

/** Refuses to load anything outside the extension folder and the allowed node_modules. */
function confinePlugin(roots: string[]): Plugin {
  return {
    name: "flutter-confine",
    setup(builder) {
      builder.onLoad({ filter: /.*/ }, (args) => {
        const file = resolve(args.path);
        if (roots.some((root) => inside(root, file))) return undefined;
        return { errors: [{ text: `Import outside the extension folder is not allowed: ${args.path}` }] };
      });
    },
  };
}

/** `import "./style.css"` -> a module that appends a <style> tag. */
function cssPlugin(): Plugin {
  return {
    name: "flutter-css",
    setup(builder) {
      builder.onLoad({ filter: /\.css$/ }, async (args) => {
        const css = await readFile(args.path, "utf8");
        return {
          loader: "js",
          contents:
            `const style = document.createElement("style");\n` +
            `style.dataset.source = ${JSON.stringify(args.path.split(sep).slice(-2).join("/"))};\n` +
            `style.textContent = ${JSON.stringify(css)};\n` +
            `document.head.appendChild(style);\n`,
        };
      });
    },
  };
}

/** Shape of a Svelte `CompileError` / warning (only the fields we read). */
type SvelteDiagnostic = {
  message?: string;
  code?: string;
  start?: { line: number; column: number };
};

/**
 * Converts a Svelte compiler error or warning into an esbuild message, so it
 * shows up with `file:line:column` and the offending line, exactly like a
 * TypeScript error does.
 */
function svelteMessage(diagnostic: SvelteDiagnostic, file: string, source: string, root: string): PartialMessage {
  const start = diagnostic.start;
  const text = diagnostic.code ? `${diagnostic.message} (svelte: ${diagnostic.code})` : String(diagnostic.message);
  if (!start) return { text };
  return {
    text,
    location: {
      file: relative(root, file).split(sep).join("/"),
      line: start.line,
      column: start.column,
      lineText: source.split(/\r?\n/)[start.line - 1] ?? "",
    },
  };
}

/**
 * Svelte 5 support.
 *  - `.svelte` components go through `svelte/compiler` `compile()`. Styles
 *    are injected at runtime (`css: "injected"`) so a component is a single
 *    JS module, just like a CSS import in a TSX page. `<script lang="ts">`
 *    works because Svelte 5 strips type annotations itself.
 *  - `.svelte.ts` / `.svelte.js` files may use runes (`$state`, `$derived`…)
 *    outside components; they go through `compileModule()`. TypeScript is
 *    stripped with esbuild first, because `compileModule` expects JavaScript.
 *
 * The emitted code imports `svelte/internal/*`, which resolves like any
 * other package: the extension's `node_modules` first, then the panel's.
 */
function sveltePlugin(root: string): Plugin {
  return {
    name: "flutter-svelte",
    setup(builder) {
      builder.onLoad({ filter: /\.svelte$/ }, async (args) => {
        const source = await readFile(args.path, "utf8");
        try {
          const result = compileSvelte(source, {
            filename: args.path,
            generate: "client",
            css: "injected",
            dev: false,
          });
          return {
            contents: result.js.code,
            loader: "js",
            resolveDir: dirname(args.path),
            warnings: result.warnings.map((warning) => svelteMessage(warning, args.path, source, root)),
          };
        } catch (err) {
          return { errors: [svelteMessage(err as SvelteDiagnostic, args.path, source, root)] };
        }
      });

      builder.onLoad({ filter: /\.svelte\.(m?js|m?ts)$/ }, async (args) => {
        const source = await readFile(args.path, "utf8");
        try {
          const js = /ts$/i.test(args.path)
            ? (await transform(source, { loader: "ts", format: "esm", target: "es2022", sourcefile: args.path })).code
            : source;
          const result = compileSvelteModule(js, { filename: args.path, generate: "client", dev: false });
          return { contents: result.js.code, loader: "js", resolveDir: dirname(args.path) };
        } catch (err) {
          const failure = err as SvelteDiagnostic & { errors?: Message[] };
          // esbuild transform failures already carry proper locations.
          if (failure.errors?.length) return { errors: failure.errors };
          return { errors: [svelteMessage(failure, args.path, source, root)] };
        }
      });
    },
  };
}

/**
 * Virtual entry that mounts a `.svelte` page component into the generated
 * page's `#root`. Svelte 5 components are functions, not classes, so they
 * need `mount()` rather than `new App()`.
 */
function svelteMountEntry(file: string): NonNullable<BuildOptions["stdin"]> {
  return {
    contents:
      `import { mount } from "svelte";\n` +
      `import App from ${JSON.stringify(`./${basename(file)}`)};\n` +
      `mount(App, { target: document.getElementById("root") ?? document.body });\n`,
    resolveDir: dirname(file),
    sourcefile: `${basename(file)}.mount.js`,
    loader: "js",
  };
}

async function stillFresh(entry: CacheEntry) {
  for (const [file, mtime] of entry.inputs) {
    const info = await stat(file).catch(() => null);
    if (!info || info.mtimeMs !== mtime) return false;
  }
  return true;
}

function formatMessages(messages: Message[]) {
  return messages
    .map((message) => {
      const where = message.location
        ? `${message.location.file}:${message.location.line}:${message.location.column}\n  ${message.location.lineText}\n`
        : "";
      return `${where}${message.text}`;
    })
    .join("\n\n");
}

/**
 * Module that reports a build failure inside the extension frame instead of
 * leaving the author staring at a blank page.
 */
function errorModule(text: string) {
  return (
    `const message = ${JSON.stringify(text)};\n` +
    `console.error("[extension build failed]\\n" + message);\n` +
    `const pre = document.createElement("pre");\n` +
    `pre.style.cssText = "margin:16px;padding:12px;border-radius:8px;white-space:pre-wrap;font:12px ui-monospace,monospace;` +
    `background:rgba(239,68,68,.1);color:#ef4444;border:1px solid rgba(239,68,68,.35)";\n` +
    `pre.textContent = "Build failed\\n\\n" + message;\n` +
    `(document.body || document.documentElement).prepend(pre);\n`
  );
}

function cacheKey(file: string, mode: ExtensionBuildMode) {
  return `${mode}:${file}`;
}

/** The absolute file a cache key was built for (strips the `<mode>:` prefix). */
function cacheKeyFile(key: string) {
  return key.slice(key.indexOf(":") + 1);
}

async function compile(extensionDir: string, file: string, mode: ExtensionBuildMode): Promise<string> {
  const extRoot = resolve(extensionDir);
  const modules = [resolve(extRoot, "node_modules"), ...panelNodeModules()];
  try {
    const result = await build({
      // A mounted Svelte page bundles a generated wrapper that imports the component.
      ...(mode === "mount" ? { stdin: svelteMountEntry(file) } : { entryPoints: [file] }),
      absWorkingDir: extRoot,
      bundle: true,
      write: false,
      metafile: true,
      format: "esm",
      platform: "browser",
      target: ["es2020"],
      jsx: "automatic",
      // Minified output keeps React-based pages small. Inline source maps
      // (dev only) still point errors at the original .tsx lines.
      minify: true,
      sourcemap: process.env.NODE_ENV === "production" ? false : "inline",
      sourcesContent: false,
      logLevel: "silent",
      nodePaths: modules,
      // `svelte`: lets component libraries from npm ship .svelte sources.
      // `production`: picks production builds where packages offer both.
      conditions: ["svelte", "production", "module"],
      resolveExtensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".svelte", ".css", ".json"],
      define: { "process.env.NODE_ENV": '"production"' },
      loader: {
        ".png": "dataurl",
        ".jpg": "dataurl",
        ".jpeg": "dataurl",
        ".gif": "dataurl",
        ".webp": "dataurl",
        ".svg": "dataurl",
        ".woff": "dataurl",
        ".woff2": "dataurl",
        ".json": "json",
        ".txt": "text",
      },
      plugins: [confinePlugin([extRoot, ...modules]), cssPlugin(), sveltePlugin(extRoot)],
    });
    const code = result.outputFiles[0]?.text ?? "";
    const inputs = new Map<string, number>();
    await Promise.all(
      Object.keys(result.metafile.inputs).map(async (input) => {
        const path = resolve(extRoot, input);
        const info = await stat(path).catch(() => null);
        if (info) inputs.set(path, info.mtimeMs);
      }),
    );
    // The stdin wrapper isn't on disk, so track the component it mounts explicitly.
    if (mode === "mount" && !inputs.has(file)) {
      const info = await stat(file).catch(() => null);
      if (info) inputs.set(file, info.mtimeMs);
    }
    cache.set(cacheKey(file, mode), { code, inputs });
    return code;
  } catch (err) {
    const failure = err as { errors?: Message[]; message?: string };
    const text = failure.errors?.length ? formatMessages(failure.errors) : (failure.message ?? String(err));
    // Not cached: the next request retries, so fixing the file is enough.
    return errorModule(text);
  }
}

/**
 * Bundled ES module for `file` (absolute path inside `extensionDir`).
 * `mode: "mount"` only makes sense for `.svelte` files; it's ignored otherwise.
 */
export async function compileExtensionModule(
  extensionDir: string,
  file: string,
  mode: ExtensionBuildMode = "module",
): Promise<string> {
  const effective: ExtensionBuildMode = mode === "mount" && /\.svelte$/i.test(file) ? "mount" : "module";
  const key = cacheKey(file, effective);
  const cached = cache.get(key);
  if (cached && (await stillFresh(cached))) return cached.code;

  const running = inFlight.get(key);
  if (running) return running;
  const job = compile(extensionDir, file, effective).finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

/** Drops cached bundles for one extension (after update/uninstall) or all of them. */
export function clearExtensionBuildCache(extensionDir?: string) {
  if (!extensionDir) {
    cache.clear();
    return;
  }
  const root = resolve(extensionDir);
  for (const key of cache.keys()) {
    if (inside(root, cacheKeyFile(key))) cache.delete(key);
  }
}
