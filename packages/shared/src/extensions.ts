/**
 * Extension system: shared contract between the API, the web panel and
 * extension authors.
 *
 * An extension is a folder in the panel's `extensions/` directory:
 *
 *   extensions/<id>/
 *     extension.json   manifest, validated by `extensionManifestSchema`
 *     ...              static web files (HTML/JS/CSS/images) it references
 *
 * Every UI contribution is rendered inside a sandboxed iframe with an opaque
 * origin. The extension never sees the user's session; it talks to the panel
 * through a postMessage bridge (`/api/v1/extensions/sdk.js`), and the panel
 * only forwards calls covered by permissions an admin approved. The viewer's
 * own server permissions still apply on top, because the panel makes each
 * call as that viewer through the normal API.
 */
import { z } from "zod";
import { SERVER_PERMISSIONS, type ServerPermission } from "./permissions";

/** Bumped when the bridge protocol changes in a way extensions must notice. */
export const EXTENSION_API_VERSION = 1;

/** Manifest file name inside each extension folder. */
export const EXTENSION_MANIFEST_FILE = "extension.json";

/* -------------------------------------------------------------------------- */
/*                                 Permissions                                */
/* -------------------------------------------------------------------------- */

export type ExtensionPermissionInfo = {
  label: string;
  description: string;
  /**
   * Server permission the *viewer* must also hold for the call to succeed.
   * Enforced by the API; listed here so the UI can explain it.
   */
  requires: ServerPermission[];
  /** Shown with a warning colour when an admin reviews the extension. */
  sensitive: boolean;
};

export const EXTENSION_PERMISSIONS = {
  "server.read": {
    label: "Read server details",
    description: "Name, status, egg, node and address of the server it is opened on.",
    requires: [],
    sensitive: false,
  },
  "console.read": {
    label: "Read console output",
    description: "Recent console lines of the server.",
    requires: ["control.console"],
    sensitive: false,
  },
  "console.command": {
    label: "Send console commands",
    description: "Run any console command as the viewer.",
    requires: ["control.console"],
    sensitive: true,
  },
  "files.read": {
    label: "Read files",
    description: "List directories and open files on the server.",
    requires: ["file.read"],
    sensitive: false,
  },
  "files.write": {
    label: "Write files",
    description: "Create and overwrite files on the server.",
    requires: ["file.write"],
    sensitive: true,
  },
  power: {
    label: "Power actions",
    description: "Start, stop, restart or kill the server.",
    requires: ["control.start", "control.stop", "control.restart"],
    sensitive: true,
  },
} as const satisfies Record<string, ExtensionPermissionInfo>;

export type ExtensionPermission = keyof typeof EXTENSION_PERMISSIONS;

export const EXTENSION_PERMISSION_KEYS = Object.keys(EXTENSION_PERMISSIONS) as [
  ExtensionPermission,
  ...ExtensionPermission[],
];

/* -------------------------------------------------------------------------- */
/*                                    Icons                                   */
/* -------------------------------------------------------------------------- */

/**
 * Icons an extension may name. Kept to a fixed list so manifests can't pull
 * arbitrary components into the panel bundle; the web app maps each name to
 * a lucide icon.
 */
export const EXTENSION_ICONS = [
  "puzzle",
  "users",
  "user",
  "gamepad",
  "chart",
  "map",
  "shield",
  "terminal",
  "globe",
  "package",
  "zap",
  "settings",
  "list",
  "box",
  "book",
  "bell",
  "heart",
  "star",
  "clock",
  "database",
] as const;

export type ExtensionIcon = (typeof EXTENSION_ICONS)[number];

/* -------------------------------------------------------------------------- */
/*                                  Manifest                                  */
/* -------------------------------------------------------------------------- */

export const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/;

/** Allowed page entry files. */
export const EXTENSION_ENTRY_PATTERN = /\.(html?|tsx|ts|jsx|js|mjs|wasm)$/i;

/**
 * For a WebAssembly entry built with wasm-bindgen (`wasm-pack --target web`,
 * or `wasm-bindgen --target web`), the JS glue module that loads it:
 *   pkg/my_ext_bg.wasm -> pkg/my_ext.js
 *   pkg/my_ext.wasm    -> pkg/my_ext.js
 * Returns null for non-wasm paths.
 */
export function extensionWasmGlue(entry: string): string | null {
  if (!/\.wasm$/i.test(entry)) return null;
  return entry.replace(/(_bg)?\.wasm$/i, ".js");
}

/** Source files the panel compiles on the fly when requested (TypeScript / JSX). */
export const EXTENSION_COMPILED_PATTERN = /\.(tsx|ts|jsx|mts)$/i;

/** Limits for installing an extension from a .zip upload. */
export const EXTENSION_ZIP_LIMITS = {
  /** Size of the uploaded archive. */
  maxArchiveBytes: 50 * 1024 * 1024,
  /** Total size once extracted (zip-bomb guard). */
  maxExtractedBytes: 200 * 1024 * 1024,
  maxFiles: 5_000,
} as const;

/**
 * Path to a file inside the extension folder. Relative, forward slashes, no
 * `..`, no dotfiles, so it can't escape the folder or expose hidden files.
 */
const extensionFilePath = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      value.split("/").every((part) => part.length > 0 && part !== ".." && !part.startsWith(".")),
    "Must be a relative path inside the extension folder",
  );

const serverPageSchema = z.object({
  /** Unique within the extension; becomes part of the page URL. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "Lowercase letters, digits and dashes"),
  /** Sidebar label. */
  label: z.string().min(1).max(24),
  icon: z.enum(EXTENSION_ICONS).default("puzzle"),
  /**
   * What the sandboxed frame renders:
   *  - an `.html` file, served as-is,
   *  - a script (`.tsx`, `.ts`, `.jsx`, `.js`, `.mjs`). The panel bundles it
   *    (TypeScript/JSX, imports, React) and wraps it in an HTML page with a
   *    `<div id="root">` and the SDK already loaded, or
   *  - a `.wasm` module built with wasm-bindgen (Rust and friends). The panel
   *    wraps it in the same page and starts it through its JS glue file (see
   *    `extensionWasmGlue`).
   */
  entry: extensionFilePath.refine(
    (value) => EXTENSION_ENTRY_PATTERN.test(value),
    "Entry must be an .html, .tsx, .ts, .jsx, .js, .mjs or .wasm file",
  ),
  /** Hide the page from viewers who lack this server permission. */
  permission: z.enum(SERVER_PERMISSIONS).optional(),
});

/**
 * Which servers an extension appears on. Patterns use `*` as a wildcard and
 * are case-insensitive. Omit `targets` to appear on every server.
 */
const targetsSchema = z
  .object({
    eggs: z.array(z.string().min(1).max(100)).max(50).optional(),
    dockerImages: z.array(z.string().min(1).max(255)).max(50).optional(),
  })
  .optional();

export const extensionManifestSchema = z.object({
  id: z.string().regex(EXTENSION_ID_PATTERN, "Lowercase letters, digits and dashes (2-48 chars)"),
  name: z.string().min(1).max(64),
  version: z.string().regex(/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/, "Semantic version, e.g. 1.0.0"),
  description: z.string().max(280).optional().default(""),
  author: z.string().max(64).optional().default(""),
  homepage: z.string().url().optional(),
  icon: z.enum(EXTENSION_ICONS).default("puzzle"),
  /** Bridge protocol the extension was written against. */
  apiVersion: z.literal(EXTENSION_API_VERSION).default(EXTENSION_API_VERSION),
  permissions: z.array(z.enum(EXTENSION_PERMISSION_KEYS)).max(EXTENSION_PERMISSION_KEYS.length).default([]),
  targets: targetsSchema,
  contributes: z
    .object({
      serverPages: z.array(serverPageSchema).max(8).default([]),
    })
    .default({}),
});

export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;
export type ExtensionServerPage = z.infer<typeof serverPageSchema>;
export type ExtensionTargets = NonNullable<ExtensionManifest["targets"]>;

/* -------------------------------------------------------------------------- */
/*                                  Matching                                  */
/* -------------------------------------------------------------------------- */

function wildcardRegex(pattern: string) {
  const escaped = pattern.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

/** True when the server's egg name or docker image matches the manifest targets. */
export function extensionTargetsServer(
  targets: ExtensionManifest["targets"],
  server: { egg?: string | null; dockerImage?: string | null },
) {
  if (!targets) return true;
  const eggs = targets.eggs ?? [];
  const images = targets.dockerImages ?? [];
  if (!eggs.length && !images.length) return true;
  const egg = server.egg ?? "";
  const image = server.dockerImage ?? "";
  return (
    (Boolean(egg) && eggs.some((pattern) => wildcardRegex(pattern).test(egg))) ||
    (Boolean(image) && images.some((pattern) => wildcardRegex(pattern).test(image)))
  );
}

/* -------------------------------------------------------------------------- */
/*                                API payloads                                */
/* -------------------------------------------------------------------------- */

/**
 * - `enabled`: approved and serving.
 * - `disabled`: installed, switched off.
 * - `needs-approval`: was enabled, but an update asks for permissions the
 *   admin hasn't granted yet. Not served until re-approved.
 * - `invalid`: folder exists but the manifest is missing or broken.
 */
export type ExtensionStatus = "enabled" | "disabled" | "needs-approval" | "invalid";

export type AdminExtension = {
  /** Folder name; equals `manifest.id` when valid. */
  id: string;
  status: ExtensionStatus;
  manifest: ExtensionManifest | null;
  /** Validation problems, for `invalid` extensions. */
  errors: string[];
  grantedPermissions: ExtensionPermission[];
  /** Requested but not granted (only for `needs-approval`). */
  pendingPermissions: ExtensionPermission[];
  enabledAt: string | null;
  /** Static code scan; null for invalid extensions or when the scan failed. */
  analysis: ExtensionAnalysis | null;
};

/* -------------------------------------------------------------------------- */
/*                                Code analysis                               */
/* -------------------------------------------------------------------------- */

/**
 * - `info`: worth knowing, not a risk (e.g. "sends the `op` command").
 * - `low`: mild smell (unused permission, minified file).
 * - `medium`: needs a look (talks to an outside server, compiled code without source).
 * - `high`: review before enabling (dynamic code execution, code loaded from the internet).
 */
export type ExtensionFindingSeverity = "info" | "low" | "medium" | "high";

export type ExtensionFinding = {
  severity: ExtensionFindingSeverity;
  /** Stable rule id, e.g. "dynamic-code". */
  rule: string;
  title: string;
  detail: string;
  /** Path inside the extension folder. */
  file?: string;
  line?: number;
  /** The offending line, trimmed and shortened. */
  snippet?: string;
};

export type ExtensionAnalysis = {
  /** Highest finding severity, ignoring `info`. */
  risk: "low" | "medium" | "high";
  findings: ExtensionFinding[];
  /** Outside hosts the code references from network calls or remote resources. */
  domains: string[];
  /** Console commands found as literals (first word), e.g. ["ban", "op"]. */
  commands: string[];
  /** Files written by literal path. */
  writes: string[];
  stats: {
    files: number;
    bytes: number;
    /** Files skipped because they were too large or binary. */
    skipped: number;
    languages: string[];
  };
  analyzedAt: string;
  /** Changes when any file changes; lets the UI tell old reports from new. */
  fingerprint: string;
};

/** One server page as the server sidebar needs it. */
export type ClientExtensionPage = {
  id: string;
  label: string;
  icon: ExtensionIcon;
  /** Absolute panel path of the HTML entry, served sandboxed. */
  src: string;
};

export type ClientExtension = {
  id: string;
  name: string;
  version: string;
  icon: ExtensionIcon;
  permissions: ExtensionPermission[];
  pages: ClientExtensionPage[];
};

/* -------------------------------------------------------------------------- */
/*                               Bridge protocol                              */
/* -------------------------------------------------------------------------- */

/** Every bridge message carries this marker so stray postMessages are ignored. */
export const EXTENSION_BRIDGE_MARKER = "__flutterExtension";

/** Bridge methods and the extension permission each needs (null = always allowed). */
export const EXTENSION_BRIDGE_METHODS = {
  "server.get": "server.read",
  "console.logs": "console.read",
  "console.command": "console.command",
  /** Keep a live console stream attached; the panel handles reconnects. */
  "console.subscribe": "console.read",
  "console.unsubscribe": "console.read",
  "files.list": "files.read",
  "files.read": "files.read",
  "files.write": "files.write",
  "server.power": "power",
  "ui.toast": null,
  "ui.navigate": null,
} as const satisfies Record<string, ExtensionPermission | null>;

export type ExtensionBridgeMethod = keyof typeof EXTENSION_BRIDGE_METHODS;
