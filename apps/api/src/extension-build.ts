/**
 * On-the-fly compiler for extension source files.
 *
 * When a sandboxed extension page requests a `.tsx` / `.ts` / `.jsx` file (or
 * any script with `?build=1`), it is bundled with esbuild:
 *  - TypeScript and JSX (automatic runtime, so no `import React` needed)
 *  - relative imports and `.css` imports (injected as <style> tags)
 *  - npm packages from the extension's own `node_modules`, falling back to
 *    the panel's (so `react` and `react-dom` work with no install step)
 *
 * Results are cached per file and reused until any input file's mtime
 * changes, so editing a file and reloading the page is enough during
 * development.
 *
 * Bundling is confined to the extension folder and the allowed node_modules
 * directories. Compiled output is served publicly, so an extension must not be
 * able to pull e.g. `../../apps/daemon/data/config.json` into its bundle.
 */
import { stat } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { build, type Message, type Plugin } from "esbuild";

type CacheEntry = { code: string; inputs: Map<string, number> };

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

async function compile(extensionDir: string, file: string): Promise<string> {
  const extRoot = resolve(extensionDir);
  const modules = [resolve(extRoot, "node_modules"), ...panelNodeModules()];
  try {
    const result = await build({
      entryPoints: [file],
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
      plugins: [confinePlugin([extRoot, ...modules]), cssPlugin()],
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
    cache.set(file, { code, inputs });
    return code;
  } catch (err) {
    const failure = err as { errors?: Message[]; message?: string };
    const text = failure.errors?.length ? formatMessages(failure.errors) : (failure.message ?? String(err));
    // Not cached: the next request retries, so fixing the file is enough.
    return errorModule(text);
  }
}

/** Bundled ES module for `file` (absolute path inside `extensionDir`). */
export async function compileExtensionModule(extensionDir: string, file: string): Promise<string> {
  const cached = cache.get(file);
  if (cached && (await stillFresh(cached))) return cached.code;

  const running = inFlight.get(file);
  if (running) return running;
  const job = compile(extensionDir, file).finally(() => inFlight.delete(file));
  inFlight.set(file, job);
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
    if (inside(root, key)) cache.delete(key);
  }
}
