/**
 * Extension registry.
 *
 * Source of truth is split on purpose:
 *  - Disk (`extensions/<id>/extension.json` + static files) holds the code.
 *    Dropping a folder in and pressing "Rescan" installs it; deleting the
 *    folder uninstalls it. No upload path can write code onto the host yet.
 *  - Mongo (`ExtensionState`) holds the admin's decision: enabled or not, and
 *    which permissions were approved.
 *
 * An extension is only served when it is enabled AND every permission its
 * current manifest requests has been granted. A manifest update that asks for
 * more parks it in `needs-approval` instead of silently widening access.
 *
 * Static files are served without a session (sandboxed iframes have an opaque
 * origin, so they can't send cookies anyway) and with a CSP `sandbox` header,
 * so even opening an asset URL directly can't run script with panel origin.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import {
  EXTENSION_COMPILED_PATTERN,
  EXTENSION_MANIFEST_FILE,
  EXTENSION_PERMISSION_KEYS,
  FlutterError,
  extensionManifestSchema,
  extensionTargetsServer,
  extensionWasmGlue,
  type AdminExtension,
  type ClientExtension,
  type ExtensionManifest,
  type ExtensionPermission,
  type ServerPermission,
} from "@flutter-software/shared";
import { Egg, ExtensionState } from "./db/models";
import { requireAccess } from "./servers";
import { log } from "./log";
import { EXTENSION_SDK_SOURCE } from "./extension-sdk";
import { clearExtensionBuildCache, compileExtensionModule } from "./extension-build";
import { exportExtensionZip, installExtensionZip, uninstallExtensionFolder } from "./extension-install";
import { analyzeExtension, clearExtensionAnalysisCache } from "./extension-analyzer";

/* -------------------------------------------------------------------------- */
/*                                  Discovery                                 */
/* -------------------------------------------------------------------------- */

/**
 * `EXTENSIONS_DIR` overrides the location. Default is `<repo>/extensions`;
 * the API runs with `apps/api` as its working directory.
 */
export function extensionsDir() {
  return resolve(process.env.EXTENSIONS_DIR?.trim() || resolve(process.cwd(), "../../extensions"));
}

type DiskExtension = {
  /** Folder name. */
  id: string;
  dir: string;
  manifest: ExtensionManifest | null;
  errors: string[];
};

/** Re-scan at most this often on hot paths, so manifest edits show up during development. */
const SCAN_TTL_MS = 10_000;
let scanCache: { at: number; rows: Promise<DiskExtension[]> } | null = null;

export function invalidateExtensionCache() {
  scanCache = null;
}

function scanDisk(): Promise<DiskExtension[]> {
  if (scanCache && Date.now() - scanCache.at < SCAN_TTL_MS) return scanCache.rows;
  const rows = readDisk().catch((err) => {
    log("warn", "extension scan failed", { error: err instanceof Error ? err.message : String(err) });
    return [] as DiskExtension[];
  });
  scanCache = { at: Date.now(), rows };
  return rows;
}

async function readDisk(): Promise<DiskExtension[]> {
  const root = extensionsDir();
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const folders = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_"));
  const rows = await Promise.all(folders.map((entry) => readExtension(entry.name, join(root, entry.name))));
  return rows.sort((a, b) => (a.manifest?.name ?? a.id).localeCompare(b.manifest?.name ?? b.id));
}

async function readExtension(id: string, dir: string): Promise<DiskExtension> {
  let raw: string;
  try {
    raw = await readFile(join(dir, EXTENSION_MANIFEST_FILE), "utf8");
  } catch {
    return { id, dir, manifest: null, errors: [`Missing ${EXTENSION_MANIFEST_FILE}`] };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { id, dir, manifest: null, errors: [`${EXTENSION_MANIFEST_FILE} is not valid JSON: ${(err as Error).message}`] };
  }

  const parsed = extensionManifestSchema.safeParse(json);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`);
    return { id, dir, manifest: null, errors };
  }

  const manifest = parsed.data;
  const errors: string[] = [];
  if (manifest.id !== id) errors.push(`Folder name "${id}" must match manifest id "${manifest.id}"`);
  const pageIds = new Set<string>();
  for (const page of manifest.contributes.serverPages) {
    if (pageIds.has(page.id)) errors.push(`Duplicate server page id "${page.id}"`);
    pageIds.add(page.id);
    if (!existsSync(join(dir, page.entry))) errors.push(`Server page "${page.id}": ${page.entry} not found`);
    const glue = extensionWasmGlue(page.entry);
    if (glue && !existsSync(join(dir, glue))) {
      errors.push(
        `Server page "${page.id}": ${glue} not found. Build the wasm with wasm-bindgen --target web (or wasm-pack build --target web) so its JS glue sits next to it.`,
      );
    }
  }
  return errors.length ? { id, dir, manifest: null, errors } : { id, dir, manifest, errors: [] };
}

/* -------------------------------------------------------------------------- */
/*                                   Status                                   */
/* -------------------------------------------------------------------------- */

type StateRow = {
  extensionId: string;
  enabled: boolean;
  grantedPermissions?: string[];
  enabledAt?: Date | null;
};

function permissionsOf(values: string[] | undefined): ExtensionPermission[] {
  const known = new Set<string>(EXTENSION_PERMISSION_KEYS);
  return (values ?? []).filter((value): value is ExtensionPermission => known.has(value));
}

function toAdmin(disk: DiskExtension, state: StateRow | undefined, analysis: AdminExtension["analysis"] = null): AdminExtension {
  const granted = permissionsOf(state?.grantedPermissions);
  const pending = disk.manifest ? disk.manifest.permissions.filter((perm) => !granted.includes(perm)) : [];
  let status: AdminExtension["status"];
  if (!disk.manifest) status = "invalid";
  else if (!state?.enabled) status = "disabled";
  else if (pending.length) status = "needs-approval";
  else status = "enabled";
  return {
    id: disk.id,
    status,
    manifest: disk.manifest,
    errors: disk.errors,
    grantedPermissions: granted,
    pendingPermissions: status === "needs-approval" ? pending : [],
    enabledAt: state?.enabled && state.enabledAt ? state.enabledAt.toISOString() : null,
    analysis,
  };
}

/** Code scan for one extension; a scanner failure never breaks the admin list. */
async function analysisFor(disk: DiskExtension): Promise<AdminExtension["analysis"]> {
  if (!disk.manifest) return null;
  try {
    return await analyzeExtension(disk.dir, disk.manifest);
  } catch (err) {
    log("warn", "extension analysis failed", { id: disk.id, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function loadStates() {
  const rows = (await ExtensionState.find().lean()) as unknown as StateRow[];
  return new Map(rows.map((row) => [row.extensionId, row]));
}

/** Enabled, valid, fully-approved extensions. */
async function activeExtensions() {
  const [disk, states] = await Promise.all([scanDisk(), loadStates()]);
  return disk
    .map((row) => ({ disk: row, admin: toAdmin(row, states.get(row.id)) }))
    .filter((row) => row.admin.status === "enabled" && row.disk.manifest)
    .map((row) => ({ dir: row.disk.dir, manifest: row.disk.manifest as ExtensionManifest }));
}

/* -------------------------------------------------------------------------- */
/*                                Admin actions                               */
/* -------------------------------------------------------------------------- */

export async function listAdminExtensions(options: { fresh?: boolean } = {}) {
  if (options.fresh) {
    invalidateExtensionCache();
    clearExtensionBuildCache();
    clearExtensionAnalysisCache();
  }
  const [disk, states] = await Promise.all([scanDisk(), loadStates()]);
  // Reports are cached per folder fingerprint, so this only re-reads changed extensions.
  const analyses = await Promise.all(disk.map((row) => analysisFor(row)));
  return {
    directory: extensionsDir(),
    extensions: disk.map((row, index) => toAdmin(row, states.get(row.id), analyses[index])),
  };
}

async function findOnDisk(id: string) {
  invalidateExtensionCache();
  const row = (await scanDisk()).find((entry) => entry.id === id);
  if (!row) throw FlutterError.notFound("Extension not found");
  return row;
}

/**
 * Enabling grants exactly the permissions the manifest requests *now*. The
 * admin saw that list in the review dialog; re-calling enable after an update
 * is how a `needs-approval` extension is approved.
 */
export async function enableExtension(id: string, actorId: string) {
  const disk = await findOnDisk(id);
  if (!disk.manifest) throw FlutterError.validation("Fix the extension's manifest before enabling it", { errors: disk.errors });
  await ExtensionState.updateOne(
    { extensionId: id },
    {
      $set: {
        enabled: true,
        grantedPermissions: disk.manifest.permissions,
        approvedVersion: disk.manifest.version,
        enabledAt: new Date(),
        updatedBy: actorId,
      },
    },
    { upsert: true },
  );
  log("info", "extension enabled", { id, version: disk.manifest.version, permissions: disk.manifest.permissions, actorId });
  return listAdminExtensions();
}

export async function disableExtension(id: string, actorId: string) {
  await findOnDisk(id);
  await ExtensionState.updateOne(
    { extensionId: id },
    { $set: { enabled: false, enabledAt: null, updatedBy: actorId } },
    { upsert: true },
  );
  log("info", "extension disabled", { id, actorId });
  return listAdminExtensions();
}

/** Installs or updates from an uploaded .zip; body: { contentBase64, replace? }. */
export async function installExtensionFromZip(body: unknown, actorId: string) {
  const input = (body ?? {}) as { contentBase64?: unknown; replace?: unknown };
  const result = await installExtensionZip(
    extensionsDir(),
    typeof input.contentBase64 === "string" ? input.contentBase64 : "",
    input.replace === true,
    actorId,
  );
  invalidateExtensionCache();
  return { result, ...(await listAdminExtensions()) };
}

export async function uninstallExtension(id: string, actorId: string) {
  const disk = await findOnDisk(id);
  await uninstallExtensionFolder(id, disk.dir, actorId);
  clearExtensionAnalysisCache(disk.dir);
  invalidateExtensionCache();
  return listAdminExtensions();
}

export async function exportExtension(id: string) {
  const disk = await findOnDisk(id);
  const version = disk.manifest?.version;
  return {
    body: await exportExtensionZip(disk.dir),
    fileName: `${id}${version ? `-${version}` : ""}.zip`,
  };
}

/* -------------------------------------------------------------------------- */
/*                                Client lookup                               */
/* -------------------------------------------------------------------------- */

/** Server pages the viewer should see in this server's sidebar. */
export async function extensionsForServer(serverId: string, viewerId: string, admin: boolean) {
  const access = await requireAccess(serverId, viewerId, admin);
  const active = await activeExtensions();
  if (!active.length) return { extensions: [] as ClientExtension[] };

  const egg = (await Egg.findById(access.server.eggId).lean()) as { name?: string; dockerImage?: string } | null;
  const target = {
    egg: egg?.name ?? "",
    dockerImage: (access.server.dockerImage as string | undefined) || egg?.dockerImage || "",
  };
  const permissions = access.permissions as string[];
  const allowed = (perm?: ServerPermission) => !perm || permissions.includes("*") || permissions.includes(perm);

  const extensions: ClientExtension[] = active
    .filter(({ manifest }) => extensionTargetsServer(manifest.targets, target))
    .map(({ manifest }) => ({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      icon: manifest.icon,
      permissions: manifest.permissions,
      pages: manifest.contributes.serverPages
        .filter((page) => allowed(page.permission))
        .map((page) => ({
          id: page.id,
          label: page.label,
          icon: page.icon,
          // HTML entries are served as-is; script entries get a generated page.
          // The version in the query string busts browser caches after an update.
          src: /\.html?$/i.test(page.entry)
            ? `/api/v1/extensions/${manifest.id}/assets/${encodeURI(page.entry)}?v=${encodeURIComponent(manifest.version)}`
            : `/api/v1/extensions/${manifest.id}/pages/${page.id}?v=${encodeURIComponent(manifest.version)}`,
        })),
    }))
    .filter((extension) => extension.pages.length > 0);

  return { extensions };
}

/* -------------------------------------------------------------------------- */
/*                                Static assets                               */
/* -------------------------------------------------------------------------- */

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  // Required for WebAssembly.instantiateStreaming, which wasm-bindgen glue uses.
  ".wasm": "application/wasm",
};

/** Largest single asset served; extensions are UI bundles, not file hosts. Rust/wasm debug builds can be large. */
const MAX_ASSET_BYTES = 32 * 1024 * 1024;

/**
 * Headers for every extension response:
 *  - `sandbox` CSP: opaque origin even when the URL is opened directly, so
 *    extension script can never read panel cookies or call the API as the user.
 *  - CORS `*`: the sandboxed frame's origin is "null", and module scripts,
 *    fetch() and fonts need CORS to load its own files.
 */
export const EXTENSION_ASSET_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-downloads",
  "Access-Control-Allow-Origin": "*",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Cache-Control": "no-cache",
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * Inline module that boots a wasm-bindgen build: imports the glue, points it
 * at the .wasm explicitly (so the versioned URL is used), then calls the
 * conventional `main`/`start` export if the crate didn't use
 * `#[wasm_bindgen(start)]`. Failures are shown in the page.
 */
function wasmBootstrap(glueUrl: string, wasmUrl: string) {
  return `
      import init, * as wasm from ${JSON.stringify(glueUrl)};
      try {
        await init({ module_or_path: ${JSON.stringify(wasmUrl)} });
        const run = wasm.main ?? wasm.start ?? wasm.run;
        if (typeof run === "function") await run();
      } catch (err) {
        console.error("[extension] wasm failed to start", err);
        const pre = document.createElement("pre");
        pre.style.cssText = "margin:16px;padding:12px;border-radius:8px;white-space:pre-wrap;font:12px ui-monospace,monospace;background:rgba(239,68,68,.1);color:#ef4444;border:1px solid rgba(239,68,68,.35)";
        pre.textContent = "WebAssembly failed to start\\n\\n" + (err && err.stack ? err.stack : String(err));
        document.body.prepend(pre);
      }
    `;
}

/**
 * HTML page for a script or wasm entry. Loads the SDK and gives the code a
 * `#root` to render into.
 *  - Scripts (`.tsx`, `.ts`, `.jsx`, `.js`, `.mjs`) are requested with
 *    `?build=1` so they're bundled even when plain `.js`.
 *  - `.wasm` entries are started through their wasm-bindgen glue module.
 */
export async function renderExtensionPage(id: string, pageId: string) {
  const extension = (await activeExtensions()).find((row) => row.manifest.id === id);
  const page = extension?.manifest.contributes.serverPages.find((row) => row.id === pageId);
  if (!extension || !page) throw FlutterError.notFound("Extension page not found or disabled");
  const version = encodeURIComponent(extension.manifest.version);
  const asset = (path: string, extra = "") => `/api/v1/extensions/${id}/assets/${encodeURI(path)}?${extra}v=${version}`;
  const glue = extensionWasmGlue(page.entry);
  const boot = glue
    ? `<script type="module">${wasmBootstrap(asset(glue), asset(page.entry))}</script>`
    : `<script type="module" src="${escapeHtml(asset(page.entry, "build=1&"))}"></script>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(`${extension.manifest.name}: ${page.label}`)}</title>
    <style>
      html, body { margin: 0; min-height: 100%; }
      body {
        background: var(--card, transparent);
        color: var(--foreground, inherit);
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        font-size: 14px;
      }
    </style>
    <script src="/api/v1/extensions/sdk.js"></script>
  </head>
  <body>
    <div id="root"></div>
    ${boot}
  </body>
</html>
`;
}

export async function readExtensionAsset(id: string, relPath: string, options: { build?: boolean } = {}) {
  const active = await activeExtensions();
  const extension = active.find((row) => row.manifest.id === id);
  if (!extension) throw FlutterError.notFound("Extension not found or disabled");

  let decoded: string;
  try {
    decoded = decodeURIComponent(relPath);
  } catch {
    throw FlutterError.validation("Bad asset path");
  }
  const parts = decoded.split("/");
  if (!decoded || parts.some((part) => !part || part === ".." || part.startsWith(".") || part.includes("\\"))) {
    throw FlutterError.notFound("Asset not found");
  }

  const root = resolve(extension.dir);
  const target = resolve(root, ...parts);
  if (!target.startsWith(root + sep)) throw FlutterError.notFound("Asset not found");

  const info = await stat(target).catch(() => null);
  if (!info?.isFile()) throw FlutterError.notFound("Asset not found");
  if (info.size > MAX_ASSET_BYTES) throw FlutterError.validation("Asset is too large");

  // TypeScript/JSX always compiles; plain JS only when a generated page asks for a bundle.
  const compiled = EXTENSION_COMPILED_PATTERN.test(target) || (options.build && /\.m?js$/i.test(target));
  if (compiled) {
    return {
      body: Buffer.from(await compileExtensionModule(extension.dir, target), "utf8"),
      contentType: "text/javascript; charset=utf-8",
    };
  }

  return {
    body: await readFile(target),
    contentType: CONTENT_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
  };
}

export function extensionSdk() {
  return EXTENSION_SDK_SOURCE;
}
