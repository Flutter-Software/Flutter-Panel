/**
 * Installing, exporting and uninstalling extensions as .zip archives.
 *
 * Install flow:
 *  1. Decode and size-check the upload, then list entries with declared sizes
 *     before inflating anything (zip-bomb guard: file count and total size).
 *  2. Find the extension root: `extension.json` at the top level, or inside a
 *     single top-level folder (what "Compress folder" produces).
 *  3. Validate every path (no `..`, no absolute paths) and the manifest.
 *  4. Extract into a hidden staging folder, validate it like any installed
 *     extension, then swap it into place. A failed install never leaves a
 *     half-written extension behind, and an update replaces files atomically
 *     enough that a running page doesn't see a mix of versions.
 *
 * Admin approval state lives in Mongo and is untouched by an update: if the
 * new manifest asks for more permissions the extension parks itself in
 * `needs-approval` (see extensions.ts).
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { unzipSync, zipSync, type Unzipped } from "fflate";
import {
  EXTENSION_MANIFEST_FILE,
  EXTENSION_ZIP_LIMITS,
  FlutterError,
  extensionManifestSchema,
  extensionWasmGlue,
} from "@flutter-software/shared";
import { ExtensionState } from "./db/models";
import { log } from "./log";
import { clearExtensionBuildCache } from "./extension-build";

/** Junk that archivers add; skipped silently. */
const IGNORED = [/^__MACOSX\//, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/i, /(^|\/)desktop\.ini$/i];

function normalizeEntry(name: string) {
  return name.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function assertSafePath(path: string) {
  const parts = path.split("/");
  if (
    path.startsWith("/") ||
    /^[a-zA-Z]:/.test(path) ||
    parts.some((part) => part === ".." || part === "")
  ) {
    throw FlutterError.validation(`Unsafe path in archive: ${path}`);
  }
}

/** Reads the archive with size/count limits enforced from the central directory. */
function readArchive(bytes: Uint8Array): Unzipped {
  let files = 0;
  let total = 0;
  try {
    return unzipSync(bytes, {
      filter(file) {
        files += 1;
        total += file.originalSize;
        if (files > EXTENSION_ZIP_LIMITS.maxFiles) {
          throw FlutterError.validation(`Archive has more than ${EXTENSION_ZIP_LIMITS.maxFiles} files`);
        }
        if (total > EXTENSION_ZIP_LIMITS.maxExtractedBytes) {
          throw FlutterError.validation(
            `Archive expands to more than ${Math.round(EXTENSION_ZIP_LIMITS.maxExtractedBytes / 1024 / 1024)} MB`,
          );
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof FlutterError) throw err;
    throw FlutterError.validation(`Not a valid .zip file: ${(err as Error).message}`);
  }
}

/**
 * Returns the archive's files relative to the extension root.
 * Accepts `extension.json` at the top level or inside exactly one folder.
 */
function extensionFiles(archive: Unzipped) {
  const files = new Map<string, Uint8Array>();
  for (const [rawName, data] of Object.entries(archive)) {
    const name = normalizeEntry(rawName);
    if (!name || name.endsWith("/") || IGNORED.some((pattern) => pattern.test(name))) continue;
    assertSafePath(name);
    files.set(name, data);
  }
  if (files.has(EXTENSION_MANIFEST_FILE)) return files;

  const tops = new Set([...files.keys()].map((name) => name.split("/")[0]));
  const [top] = [...tops];
  if (tops.size === 1 && files.has(`${top}/${EXTENSION_MANIFEST_FILE}`)) {
    const prefix = `${top}/`;
    return new Map([...files].map(([name, data]) => [name.slice(prefix.length), data] as const));
  }
  throw FlutterError.validation(
    `No ${EXTENSION_MANIFEST_FILE} found. Put it at the top of the zip or inside a single folder.`,
  );
}

function parseManifest(data: Uint8Array) {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(data));
  } catch (err) {
    throw FlutterError.validation(`${EXTENSION_MANIFEST_FILE} is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = extensionManifestSchema.safeParse(json);
  if (!parsed.success) {
    throw FlutterError.validation(
      `Invalid ${EXTENSION_MANIFEST_FILE}: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

export type ZipInstallResult = { id: string; version: string; replaced: boolean; previousVersion: string | null };

/**
 * Installs (or, with `replace`, updates) an extension from a base64 zip.
 * Throws a 409 CONFLICT when it already exists and `replace` is false, so the
 * UI can ask before overwriting.
 */
export async function installExtensionZip(root: string, contentBase64: string, replace: boolean, actorId: string) {
  if (typeof contentBase64 !== "string" || !contentBase64) throw FlutterError.validation("contentBase64 is required");
  const bytes = Buffer.from(contentBase64.replace(/^data:[^,]*,/, ""), "base64");
  if (bytes.length > EXTENSION_ZIP_LIMITS.maxArchiveBytes) {
    throw FlutterError.validation(
      `Archive is larger than ${Math.round(EXTENSION_ZIP_LIMITS.maxArchiveBytes / 1024 / 1024)} MB`,
    );
  }

  const files = extensionFiles(readArchive(new Uint8Array(bytes)));
  const manifest = parseManifest(files.get(EXTENSION_MANIFEST_FILE)!);
  for (const page of manifest.contributes.serverPages) {
    if (!files.has(page.entry)) throw FlutterError.validation(`Server page "${page.id}": ${page.entry} is missing from the zip`);
    const glue = extensionWasmGlue(page.entry);
    if (glue && !files.has(glue)) {
      throw FlutterError.validation(
        `Server page "${page.id}": ${glue} is missing from the zip. Include the wasm-bindgen JS glue next to the .wasm.`,
      );
    }
  }

  await mkdir(root, { recursive: true });
  const target = join(root, manifest.id);
  const exists = existsSync(target);
  let previousVersion: string | null = null;
  if (exists) {
    previousVersion = await readFile(join(target, EXTENSION_MANIFEST_FILE), "utf8")
      .then((raw) => String((JSON.parse(raw) as { version?: unknown }).version ?? "") || null)
      .catch(() => null);
    if (!replace) {
      throw FlutterError.conflict(
        `"${manifest.name}" is already installed${previousVersion ? ` (v${previousVersion})` : ""}. Replace it with v${manifest.version}?`,
      );
    }
  }

  // Dot-prefixed folders are ignored by the scanner, so staging is invisible.
  const staging = join(root, `.staging-${randomUUID()}`);
  const trash = join(root, `.trash-${randomUUID()}`);
  try {
    const stagingRoot = resolve(staging);
    for (const [name, data] of files) {
      const dest = resolve(stagingRoot, ...name.split("/"));
      if (!dest.startsWith(stagingRoot + sep)) throw FlutterError.validation(`Unsafe path in archive: ${name}`);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, data);
    }
    if (exists) await rename(target, trash);
    await rename(staging, target);
  } catch (err) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    // Put the previous version back if the swap failed half-way.
    if (exists && !existsSync(target) && existsSync(trash)) await rename(trash, target).catch(() => undefined);
    throw err;
  }
  await rm(trash, { recursive: true, force: true }).catch(() => undefined);
  clearExtensionBuildCache(target);

  log("info", exists ? "extension updated from zip" : "extension installed from zip", {
    id: manifest.id,
    version: manifest.version,
    previousVersion,
    files: files.size,
    actorId,
  });
  return { id: manifest.id, version: manifest.version, replaced: exists, previousVersion } satisfies ZipInstallResult;
}

/** Deletes the extension's folder and its admin state. */
export async function uninstallExtensionFolder(id: string, dir: string, actorId: string) {
  await rm(dir, { recursive: true, force: true });
  await ExtensionState.deleteOne({ extensionId: id });
  clearExtensionBuildCache(dir);
  log("info", "extension uninstalled", { id, actorId });
}

/** Folders never included in an exported zip (dependencies and build caches). */
const EXPORT_SKIP = new Set(["node_modules", ".git", "target"]);

/** Zips an installed extension so it can be shared or backed up. */
export async function exportExtensionZip(dir: string) {
  const root = resolve(dir);
  const out: Record<string, Uint8Array> = {};
  let total = 0;

  async function walk(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (EXPORT_SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const info = await stat(full);
        total += info.size;
        if (total > EXTENSION_ZIP_LIMITS.maxExtractedBytes) {
          throw FlutterError.validation("Extension is too large to export");
        }
        out[relative(root, full).split(sep).join("/")] = new Uint8Array(await readFile(full));
      }
    }
  }

  await walk(root);
  return Buffer.from(zipSync(out, { level: 6 }));
}
