/**
 * Static code scanner for extensions.
 *
 * Runs over an extension folder (source, HTML, compiled wasm) and produces a
 * report an admin sees before enabling it. It is a heuristic reviewer's aid,
 * not a sandbox: the sandbox and permission checks are what actually contain
 * an extension. The scanner's job is to surface what's worth a human look:
 *
 *  - code that can change after review (remote scripts, eval/new Function)
 *  - where data could go (outside domains in network calls or resources)
 *  - what it will do to servers (literal console commands, files written)
 *  - permission hygiene (requested but unused, used but not requested)
 *  - things that can't be reviewed (minified/obfuscated code, wasm without source)
 *  - risky combinations (reads server data AND talks to the internet)
 *
 * Reports are cached per folder fingerprint (paths + sizes + mtimes), so the
 * admin list stays fast and re-scans only happen after a file changes.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import {
  extensionWasmGlue,
  type ExtensionAnalysis,
  type ExtensionFinding,
  type ExtensionFindingSeverity,
  type ExtensionManifest,
  type ExtensionPermission,
} from "@flutter-software/shared";

/* -------------------------------------------------------------------------- */
/*                                   Limits                                   */
/* -------------------------------------------------------------------------- */

/** Dependency and build folders: third-party code the admin can't meaningfully review. */
const SKIP_DIRS = new Set(["node_modules", "target", ".git"]);
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_WASM_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 5_000;
/** Same rule on the same file is reported once per this many hits, to keep reports readable. */
const MAX_FINDINGS_PER_RULE_FILE = 3;
const MAX_FINDINGS = 200;

const TEXT_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".mts", ".html", ".htm", ".rs", ".css"]);
const LANGUAGE: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".js": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".jsx": "JavaScript",
  ".html": "HTML",
  ".htm": "HTML",
  ".css": "CSS",
  ".rs": "Rust",
  ".wasm": "WebAssembly",
};

/** Hosts that appear in code without meaning network traffic. */
const BENIGN_HOSTS = [
  /^localhost$/,
  /^127\./,
  /^0\.0\.0\.0$/,
  /(^|\.)w3\.org$/,
  /(^|\.)example\.(com|org|net)$/,
  /(^|\.)schema\.org$/,
  /(^|\.)json-schema\.org$/,
  /(^|\.)reactjs\.org$/,
  /(^|\.)react\.dev$/,
  /(^|\.)mozilla\.org$/,
  /(^|\.)rustwasm\.github\.io$/,
];

/* -------------------------------------------------------------------------- */
/*                                    Rules                                   */
/* -------------------------------------------------------------------------- */

type LineRule = {
  rule: string;
  severity: ExtensionFindingSeverity;
  title: string;
  detail: string;
  pattern: RegExp;
  /** Limit to some file extensions. */
  only?: string[];
};

const LINE_RULES: LineRule[] = [
  {
    rule: "dynamic-code",
    severity: "high",
    title: "Runs code built at runtime",
    detail:
      "eval / new Function / string timers execute text as code. What runs can differ from what you reviewed, and it's a common way to hide behaviour.",
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(|\bset(?:Timeout|Interval)\s*\(\s*["'`]/,
    only: [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".mts", ".html", ".htm"],
  },
  {
    rule: "remote-script",
    severity: "high",
    title: "Loads code from the internet",
    detail:
      "The extension pulls script from an outside server at runtime. That code isn't part of what you're approving and can change at any time.",
    pattern:
      /<script[^>]+src\s*=\s*["']\s*(?:https?:)?\/\/|\bimport\s*\(\s*["'`]https?:\/\/|\bfrom\s+["']https?:\/\/|importScripts\s*\(\s*["'`]https?:/i,
  },
  {
    rule: "panel-navigation",
    severity: "high",
    title: "Tries to control the panel window",
    detail:
      "References window.top / parent.location. The sandbox blocks navigating the panel, but legitimate extensions have no reason to try.",
    pattern: /\b(?:window\.)?top\.location\b|\bparent\.location\b|\bwindow\.top\b/,
  },
  {
    rule: "miner",
    severity: "high",
    title: "Looks like a crypto-miner",
    detail: "Contains names associated with in-browser cryptocurrency mining.",
    pattern: /coinhive|cryptonight|coin-hive|cryptoloot|webminepool|\bminero\b/i,
  },
  {
    rule: "cookie-storage",
    severity: "low",
    title: "Reads cookies",
    detail:
      "Uses document.cookie. Extensions run with an opaque origin, so there are no panel cookies to read. This usually means copied code, occasionally an attempt to grab sessions.",
    pattern: /document\.cookie/,
  },
  {
    rule: "direct-postmessage",
    severity: "low",
    title: "Messages the panel directly",
    detail:
      "Calls parent.postMessage instead of the SDK. The panel still checks permissions, but bypassing the SDK is unusual.",
    pattern: /\b(?:parent|top)\.postMessage\s*\(/,
  },
  {
    rule: "remote-resource",
    severity: "medium",
    title: "Loads resources from an outside server",
    detail:
      "Images, styles or fonts from another server let that server see when the page is opened (and from which IP).",
    pattern:
      /<(?:img|link|iframe|video|audio|source)[^>]+(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\/|@import\s+(?:url\()?\s*["']?https?:|url\(\s*["']?https?:/i,
  },
];

/** Network APIs; combined with an outside domain they mean "sends data out". */
const NETWORK_API =
  /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket\s*\(|EventSource\s*\(|sendBeacon\s*\(|\bRequest::new|web_sys::(?:WebSocket|Request|EventSource)|window\(\)\.[\s\S]{0,40}fetch_with/;

/** Literal console commands: JS SDK, Rust SDK and raw bridge calls. */
const COMMAND_LITERALS = [
  /\bconsole\.(?:command|run)\s*\(\s*["'`]([^"'`$]{1,120})["'`]/g,
  /\bconsole::(?:command|run)\s*\(\s*"([^"]{1,120})"/g,
  /["']console\.command["']\s*,\s*\{\s*command\s*:\s*["'`]([^"'`$]{1,120})["'`]/g,
];
/** Templated commands like `"op " + name` / `op ${name}` / format!("op {}", ...). */
const COMMAND_PREFIXES = [
  /\[\s*["'][^"']{1,40}["']\s*,\s*["'`]([a-z][\w-]{1,30}) ["'`]\s*\+/g,
  /\bconsole\.(?:command|run)\s*\(\s*`([a-z][\w-]{1,30})\s/g,
  /console::(?:command|run)\(\s*&?format!\(\s*"([a-z][\w-]{1,30}) \{/g,
];

const WRITE_LITERALS = [/\bfiles\.write\s*\(\s*["'`]([^"'`$]{1,200})["'`]/g, /\bfiles::write\s*\(\s*"([^"]{1,200})"/g];

/** How the code uses each sensitive SDK capability (JS, Rust and raw calls). */
const PERMISSION_USAGE: Partial<Record<ExtensionPermission, RegExp>> = {
  "console.command": /console\.(?:command|run)\s*\(|console::(?:command|run)\s*\(|["']console\.command["']/,
  "console.read": /console\.(?:logs|subscribe|run)\s*\(|console::(?:logs|subscribe|run)\s*\(|["']console\.(?:logs|subscribe)["']/,
  "files.read": /files\.(?:read|list)\s*\(|files::(?:read|list)\s*\(|["']files\.(?:read|list)["']/,
  "files.write": /files\.write\s*\(|files::write\s*\(|["']files\.write["']/,
  power: /server\.power\s*\(|server::power\s*\(|["']server\.power["']/,
};

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

type Collected = { path: string; rel: string; ext: string; size: number; mtimeMs: number };

async function collect(root: string): Promise<{ files: Collected[]; truncated: boolean }> {
  const files: Collected[] = [];
  let truncated = false;
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const info = await stat(full);
        files.push({
          path: full,
          rel: relative(root, full).split(sep).join("/"),
          ext: extname(entry.name).toLowerCase(),
          size: info.size,
          mtimeMs: info.mtimeMs,
        });
      }
    }
  }
  await walk(root);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { files, truncated };
}

function fingerprintOf(files: Collected[], manifest: ExtensionManifest) {
  const hash = createHash("sha1");
  hash.update(JSON.stringify(manifest.permissions));
  for (const file of files) hash.update(`${file.rel}|${file.size}|${file.mtimeMs}\n`);
  return hash.digest("base64url").slice(0, 16);
}

function isCommentLine(line: string) {
  const trimmed = line.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("<!--");
}

/**
 * Blanks out lines that are comments: `//` lines plus every line of a
 * multi-line `/* … *\/` or `<!-- … -->` block. Line numbers are preserved, so
 * findings still point at the right place. Docs in comments ("don't use
 * eval") would otherwise be reported as code.
 */
function codeLines(text: string) {
  const lines = text.split("\n");
  let closer: string | null = null;
  return lines.map((line) => {
    if (closer) {
      if (line.includes(closer)) closer = null;
      return "";
    }
    const trimmed = line.trimStart();
    for (const [open, close] of [
      ["/*", "*/"],
      ["<!--", "-->"],
    ] as const) {
      if (trimmed.startsWith(open)) {
        if (!trimmed.slice(open.length).includes(close)) closer = close;
        return "";
      }
    }
    return isCommentLine(line) ? "" : line;
  });
}

function snippetOf(line: string) {
  const trimmed = line.trim();
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}…` : trimmed;
}

function hostsIn(line: string) {
  const hosts: string[] = [];
  for (const match of line.matchAll(/(?:https?:|wss?:)?\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)+)(?::\d+)?/gi)) {
    const host = match[1].toLowerCase();
    if (!BENIGN_HOSTS.some((pattern) => pattern.test(host))) hosts.push(host);
  }
  return hosts;
}

/** Long base64 / hex-escape runs and very long lines suggest packed or obfuscated code. */
function obfuscationSignal(text: string) {
  const longLine = text.split("\n").some((line) => line.length > 2_000);
  const blob = /[A-Za-z0-9+/]{3000,}={0,2}/.test(text);
  const escapes = /(?:\\x[0-9a-f]{2}){40,}|(?:\\u[0-9a-f]{4}){40,}/i.test(text);
  return { longLine, blob, escapes };
}

/* ------------------------------- wasm imports ------------------------------ */

/**
 * Lists a wasm module's imports ("module.name") by reading its import
 * section. Malformed modules return null.
 */
export function wasmImports(bytes: Uint8Array): string[] | null {
  if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) return null;
  let offset = 8;
  const leb = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (offset >= bytes.length) throw new Error("eof");
      const byte = bytes[offset++];
      result |= (byte & 0x7f) << shift;
      if (!(byte & 0x80)) return result >>> 0;
      shift += 7;
      if (shift > 35) throw new Error("leb");
    }
  };
  const name = () => {
    const length = leb();
    const value = new TextDecoder().decode(bytes.subarray(offset, offset + length));
    offset += length;
    return value;
  };
  try {
    while (offset < bytes.length) {
      const id = bytes[offset++];
      const size = leb();
      const end = offset + size;
      if (id !== 2) {
        offset = end;
        continue;
      }
      const imports: string[] = [];
      const count = leb();
      for (let i = 0; i < count; i++) {
        const module = name();
        const field = name();
        const kind = bytes[offset++];
        if (kind === 0) leb(); // func: type index
        else if (kind === 1) {
          offset++; // reftype
          const flags = leb();
          leb();
          if (flags & 1) leb();
        } else if (kind === 2) {
          const flags = leb();
          leb();
          if (flags & 1) leb();
        } else if (kind === 3) offset += 2; // global: valtype + mut
        else if (kind === 4) {
          offset++;
          leb();
        } // tag
        imports.push(`${module}.${field}`);
      }
      return imports;
    }
    return [];
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*                                   Scanner                                  */
/* -------------------------------------------------------------------------- */

const cache = new Map<string, ExtensionAnalysis>();

const SEVERITY_ORDER: Record<ExtensionFindingSeverity, number> = { high: 3, medium: 2, low: 1, info: 0 };

export function clearExtensionAnalysisCache(dir?: string) {
  if (!dir) cache.clear();
  else cache.delete(dir);
}

export async function analyzeExtension(dir: string, manifest: ExtensionManifest): Promise<ExtensionAnalysis> {
  const { files, truncated } = await collect(dir);
  const fingerprint = fingerprintOf(files, manifest);
  const cached = cache.get(dir);
  if (cached && cached.fingerprint === fingerprint) return cached;

  const findings: ExtensionFinding[] = [];
  const perRuleFile = new Map<string, number>();
  const domains = new Set<string>();
  const networkFiles = new Set<string>();
  const commands = new Set<string>();
  const writes = new Set<string>();
  const languages = new Set<string>();
  const usedPermissions = new Set<ExtensionPermission>();
  let bytes = 0;
  let skipped = 0;

  const add = (finding: ExtensionFinding) => {
    const key = `${finding.rule}|${finding.file ?? ""}`;
    const seen = perRuleFile.get(key) ?? 0;
    perRuleFile.set(key, seen + 1);
    if (seen < MAX_FINDINGS_PER_RULE_FILE) findings.push(finding);
  };

  const entries = new Set(manifest.contributes.serverPages.map((page) => page.entry));
  const glueFiles = new Set(
    manifest.contributes.serverPages.map((page) => extensionWasmGlue(page.entry)).filter((v): v is string => Boolean(v)),
  );
  const hasRustSource = files.some((file) => file.ext === ".rs");

  for (const file of files) {
    bytes += file.size;
    if (LANGUAGE[file.ext]) languages.add(LANGUAGE[file.ext]);

    /* ---------------------------- WebAssembly ---------------------------- */
    if (file.ext === ".wasm") {
      if (file.size > MAX_WASM_BYTES) {
        skipped++;
        continue;
      }
      const imports = wasmImports(new Uint8Array(await readFile(file.path)));
      if (!imports) {
        add({ severity: "medium", rule: "wasm-invalid", title: "Unreadable WebAssembly", detail: "Couldn't parse this .wasm file's imports.", file: file.rel });
        continue;
      }
      // wasm-bindgen import names embed the JS API they call, e.g. __wbg_fetch_1234.
      const network = imports.filter((name) => /fetch|websocket|xmlhttprequest|sendbeacon|eventsource/i.test(name));
      if (network.length) {
        networkFiles.add(file.rel);
        add({
          severity: "medium",
          rule: "wasm-network",
          title: "Compiled code can make network requests",
          detail: `Imports ${network.slice(0, 4).join(", ")}${network.length > 4 ? "…" : ""}. Check the source for where it connects.`,
          file: file.rel,
        });
      }
      // wasm-bindgen names imports after the JS API (`__wbg_eval_…`). Its own
      // `newnoargs` helper is left out on purpose: it's the standard globalThis lookup.
      if (imports.some((name) => /(^|[._])eval(_|$)|new_function|function_new/i.test(name))) {
        add({
          severity: "high",
          rule: "dynamic-code",
          title: "Compiled code builds functions at runtime",
          detail: "This module imports a JS function constructor (eval / new Function).",
          file: file.rel,
        });
      }
      if (!hasRustSource) {
        add({
          severity: "medium",
          rule: "no-source",
          title: "Compiled code without source",
          detail:
            "The extension ships WebAssembly but no source files, so its behaviour can't be reviewed beyond what it imports. Ask the author for the source or build it yourself.",
          file: file.rel,
        });
      }
      continue;
    }

    if (!TEXT_EXT.has(file.ext)) continue;
    if (file.size > MAX_TEXT_BYTES) {
      skipped++;
      add({ severity: "low", rule: "too-large", title: "File too large to scan", detail: `${Math.round(file.size / 1024)} KB; skipped.`, file: file.rel });
      continue;
    }

    const text = await readFile(file.path, "utf8");
    const generatedGlue = glueFiles.has(file.rel);

    // Obfuscation / minification: can't be reviewed by reading it.
    if (!generatedGlue && file.ext !== ".rs" && file.ext !== ".css") {
      const signal = obfuscationSignal(text);
      if (signal.escapes || signal.blob) {
        add({
          severity: "medium",
          rule: "obfuscated",
          title: "Looks obfuscated",
          detail: "Long runs of escaped characters or encoded data. Packed code is hard to review and often hides behaviour.",
          file: file.rel,
        });
      } else if (signal.longLine) {
        add({
          severity: "low",
          rule: "minified",
          title: "Minified file",
          detail: "Very long lines suggest bundled or minified code. Prefer extensions that ship readable source.",
          file: file.rel,
        });
      }
    }

    // Usage signals, on the whole file.
    for (const [perm, pattern] of Object.entries(PERMISSION_USAGE) as [ExtensionPermission, RegExp][]) {
      if (pattern.test(text)) usedPermissions.add(perm);
    }
    for (const pattern of [...COMMAND_LITERALS, ...COMMAND_PREFIXES]) {
      for (const match of text.matchAll(pattern)) {
        const word = match[1].trim().split(/\s+/)[0]?.replace(/^\//, "");
        if (word) commands.add(word.toLowerCase());
      }
    }
    for (const pattern of WRITE_LITERALS) {
      for (const match of text.matchAll(pattern)) writes.add(match[1]);
    }

    // Per-line rules, skipping comments. Generated glue is checked only for remote code.
    const lines = codeLines(text);
    const fileUsesNetwork = NETWORK_API.test(lines.join("\n"));
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line || line.length > 5_000) continue;
      for (const rule of LINE_RULES) {
        if (rule.only && !rule.only.includes(file.ext)) continue;
        if (generatedGlue && rule.rule !== "remote-script") continue;
        if (!rule.pattern.test(line)) continue;
        add({ severity: rule.severity, rule: rule.rule, title: rule.title, detail: rule.detail, file: file.rel, line: index + 1, snippet: snippetOf(line) });
        for (const host of hostsIn(line)) domains.add(host);
      }
      if (fileUsesNetwork && !generatedGlue) {
        const hosts = hostsIn(line);
        if (hosts.length) {
          networkFiles.add(file.rel);
          for (const host of hosts) domains.add(host);
          add({
            severity: "medium",
            rule: "external-network",
            title: `Connects to ${hosts.join(", ")}`,
            detail: "Data the extension can see (server details, console output, files) could be sent to this server.",
            file: file.rel,
            line: index + 1,
            snippet: snippetOf(line),
          });
        }
      }
    }
  }

  /* ------------------------------ Permissions ------------------------------ */

  const requested = new Set(manifest.permissions);
  for (const perm of ["console.command", "files.write", "power", "files.read"] as ExtensionPermission[]) {
    if (requested.has(perm) && !usedPermissions.has(perm)) {
      add({
        severity: "low",
        rule: "unused-permission",
        title: `Requests "${perm}" but doesn't seem to use it`,
        detail: "Least privilege: ask the author to drop permissions it doesn't need. (Dynamic calls can't always be detected.)",
      });
    }
  }
  for (const perm of usedPermissions) {
    if (!requested.has(perm)) {
      add({
        severity: "info",
        rule: "missing-permission",
        title: `Uses "${perm}" without requesting it`,
        detail: "Those calls will fail with a permission error until the manifest requests it.",
      });
    }
  }

  /* ----------------------------- Combinations ------------------------------ */

  const external = networkFiles.size > 0;
  if (external && (requested.has("files.write") || requested.has("console.command") || requested.has("power"))) {
    add({
      severity: "high",
      rule: "remote-control",
      title: "Can change servers and talks to the internet",
      detail:
        "It may run commands or write files and also contacts outside servers. A remote server could steer what it does. Make sure you trust both the code and those hosts.",
    });
  } else if (external && (requested.has("files.read") || requested.has("console.read"))) {
    add({
      severity: "medium",
      rule: "data-egress",
      title: "Reads server data and talks to the internet",
      detail: "It can read files or console output and contacts outside servers. Check what it sends.",
    });
  }
  if (truncated) {
    add({ severity: "medium", rule: "truncated", title: "Too many files to scan fully", detail: `Only the first ${MAX_FILES} files were checked.` });
  }
  for (const entry of entries) {
    if (!files.some((file) => file.rel === entry)) {
      add({ severity: "info", rule: "missing-entry", title: `Entry ${entry} not found`, detail: "The page won't load." });
    }
  }
  // One summary line for impactful commands; the full list is in `analysis.commands`.
  const impactful = [...commands].filter((command) =>
    /^(stop|restart|op|deop|ban|ban-ip|pardon|pardon-ip|kick|whitelist|save-off|kill|execute|gamemode|give|lp|luckperms|sudo)$/.test(command),
  );
  if (impactful.length) {
    add({
      severity: "info",
      rule: "commands",
      title: `Sends commands: ${impactful.sort().join(", ")}`,
      detail: "Found as literals in the code. Viewers still need console access on the server for them to run.",
    });
  }

  findings.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);
  const top = findings.filter((finding) => finding.severity !== "info").reduce(
    (max, finding) => Math.max(max, SEVERITY_ORDER[finding.severity]),
    0,
  );

  const analysis: ExtensionAnalysis = {
    risk: top >= 3 ? "high" : top === 2 ? "medium" : "low",
    findings: findings.slice(0, MAX_FINDINGS),
    domains: [...domains].sort(),
    commands: [...commands].sort(),
    writes: [...writes].sort(),
    stats: { files: files.length, bytes, skipped, languages: [...languages].sort() },
    analyzedAt: new Date().toISOString(),
    fingerprint,
  };
  cache.set(dir, analysis);
  return analysis;
}
