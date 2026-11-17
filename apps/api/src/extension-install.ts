/**
 * Installing, exporting and uninstalling extensions as .zip archives.
 *
 * Install flow (nothing here holds the archive or its files in memory, so the
 * 2 GiB upload limit costs disk space, not API memory):
 *  1. Stream the raw request body into a hidden `.upload-<uuid>.zip` next to
 *     the extensions, counting bytes and stopping at the size limit.
 *  2. Read the zip's central directory (zip-reader.ts) and enforce the file
 *     count and total unpacked size on the declared sizes before inflating
 *     anything (zip-bomb guard; the reader verifies the declarations later).
 *  3. Find the extension root: `extension.json` at the top level, or inside a
 *     single top-level folder (what "Compress folder" produces).
 *  4. Validate every path (no `..`, no absolute paths) and the manifest, and
 *     answer 409 for an existing extension before unpacking anything.
 *  5. Extract entry by entry into a hidden staging folder, then swap it into
 *     place. A failed install never leaves a half-written extension behind,
 *     and an update replaces files atomically enough that a running page
 *     doesn't see a mix of versions.
 *
 * Admin approval state lives in Mongo and is untouched by an update: if the
 * new manifest asks for more permissions the extension parks itself in
 * `needs-approval` (see extensions.ts).
 */
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { zipSync } from "fflate";
import {
  EXTENSION_MANIFEST_FILE,
  EXTENSION_ZIP_LIMITS,
  FlutterError,
  extensionManifestSchema,
  extensionWasmGlue,
  formatExtensionLimit,
} from "@flutter-software/shared";
import { ExtensionState } from "./db/models";
import { log } from "./log";
import { clearExtensionBuildCache } from "./extension-build";
import { ZipReader, isZipDataError, type ZipEntry } from "./zip-reader";

/** Junk that archivers add; skipped silently. */
const IGNORED = [/^__MACOSX\//, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/i, /(^|\/)desktop\.ini$/i];

/** The manifest is the only entry read into memory; anything bigger than this isn't a manifest. */
const MAX_MANIFEST_BYTES = 1024 * 1024;

/**
 * Hidden work files this module creates in the extensions folder. Dot-prefixed
 * so the scanner ignores them. They are removed when an install ends; a crash
 * mid-install can strand one, so each install sweeps old ones first.
 */
const LEFTOVER_PATTERN = /^\.(upload|staging|trash)-/;
/** Far longer than any install takes, so a sweep never touches one in progress. */
const LEFTOVER_MAX_AGE_MS = 6 * 60 * 60 * 1000;

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

/* -------------------------------------------------------------------------- */
/*                             Receiving the upload                           */
/* -------------------------------------------------------------------------- */

/** Pass-through that fails the pipeline once more than `max` bytes went by. */
class ByteLimit extends Transform {
  private seen = 0;

  constructor(
    private readonly max: number,
    private readonly message: string,
  ) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
    this.seen += chunk.length;
    if (this.seen > this.max) {
      callback(FlutterError.validation(this.message));
      return;
    }
    callback(null, chunk);
  }
}

/**
 * Turns low-level failures into messages an admin can act on. Anything that
 * isn't the archive's fault or a full disk is passed through unchanged (500).
 */
function asInstallError(err: unknown) {
  if (err instanceof FlutterError) return err;
  if (isZipDataError(err)) return FlutterError.validation(`Not a valid .zip file: ${err.message}`);
  if ((err as NodeJS.ErrnoException | null)?.code === "ENOSPC") {
    return FlutterError.validation("The panel host ran out of disk space while installing this extension.");
  }
  return err;
}

/** Best-effort removal of work files stranded by a crashed install. */
async function sweepLeftovers(root: string) {
  const cutoff = Date.now() - LEFTOVER_MAX_AGE_MS;
  for (const name of await readdir(root).catch(() => [] as string[])) {
    if (!LEFTOVER_PATTERN.test(name)) continue;
    const path = join(root, name);
    const info = await stat(path).catch(() => null);
    if (info && info.mtimeMs < cutoff) await rm(path, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Streams the request body to a hidden file in `root` and returns its path.
 * The size limit is enforced twice: up front from Content-Length (cheap, but
 * only a claim) and on the bytes actually received. The caller deletes the file.
 */
async function receiveArchive(root: string, request: Request) {
  const max = EXTENSION_ZIP_LIMITS.maxArchiveBytes;
  const tooLarge = `Archive is larger than ${formatExtensionLimit(max)}`;
  if (Number(request.headers.get("content-length")) > max) throw FlutterError.validation(tooLarge);
  if (!request.body) throw FlutterError.validation("Upload is empty. Send the .zip file as the request body.");

  const path = join(root, `.upload-${randomUUID()}.zip`);
  try {
    await pipeline(
      Readable.fromWeb(request.body as unknown as WebReadableStream),
      new ByteLimit(max, tooLarge),
      createWriteStream(path),
    );
  } catch (err) {
    await rm(path, { force: true }).catch(() => undefined);
    throw asInstallError(err);
  }
  return path;
}

/* -------------------------------------------------------------------------- */
/*                             Reading the archive                            */
/* -------------------------------------------------------------------------- */

/**
 * Returns the archive's files keyed by their path relative to the extension
 * root, after enforcing the count and size limits on the declared sizes.
 * Accepts `extension.json` at the top level or inside exactly one folder.
 */
function extensionFiles(entries: readonly ZipEntry[]) {
  const files = new Map<string, ZipEntry>();
  let count = 0;
  let total = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    count += 1;
    total += entry.uncompressedSize;
    if (count > EXTENSION_ZIP_LIMITS.maxFiles) {
      throw FlutterError.validation(`Archive has more than ${EXTENSION_ZIP_LIMITS.maxFiles} files`);
    }
    if (total > EXTENSION_ZIP_LIMITS.maxExtractedBytes) {
      throw FlutterError.validation(
        `Archive expands to more than ${formatExtensionLimit(EXTENSION_ZIP_LIMITS.maxExtractedBytes)}`,
      );
    }
    const name = normalizeEntry(entry.name);
    if (!name || IGNORED.some((pattern) => pattern.test(name))) continue;
    assertSafePath(name);
    files.set(name, entry);
  }
  if (files.has(EXTENSION_MANIFEST_FILE)) return files;

  const tops = new Set([...files.keys()].map((name) => name.split("/")[0]));
  const [top] = [...tops];
  if (tops.size === 1 && files.has(`${top}/${EXTENSION_MANIFEST_FILE}`)) {
    const prefix = `${top}/`;
    return new Map([...files].map(([name, entry]) => [name.slice(prefix.length), entry] as const));
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

/* -------------------------------------------------------------------------- */
/*                                   Install                                  */
/* -------------------------------------------------------------------------- */

export type ZipInstallResult = { id: string; version: string; replaced: boolean; previousVersion: string | null };

/** Validates the opened archive, extracts it into staging and swaps it into `root`. */
async function installFromArchive(root: string, reader: ZipReader, replace: boolean, actorId: string) {
  const files = extensionFiles(reader.entries);
  const manifest = parseManifest(await reader.readBuffer(files.get(EXTENSION_MANIFEST_FILE)!, MAX_MANIFEST_BYTES));
  for (const page of manifest.contributes.serverPages) {
    if (!files.has(page.entry)) throw FlutterError.validation(`Server page "${page.id}": ${page.entry} is missing from the zip`);
    const glue = extensionWasmGlue(page.entry);
    if (glue && !files.has(glue)) {
      throw FlutterError.validation(
        `Server page "${page.id}": ${glue} is missing from the zip. Include the wasm-bindgen JS glue next to the .wasm.`,
      );
    }
  }

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
    for (const [name, entry] of files) {
      const dest = resolve(stagingRoot, ...name.split("/"));
      if (!dest.startsWith(stagingRoot + sep)) throw FlutterError.validation(`Unsafe path in archive: ${name}`);
      await mkdir(dirname(dest), { recursive: true });
      // One entry at a time: inflated, size- and CRC-checked, straight to disk.
      await pipeline(await reader.openStream(entry), createWriteStream(dest));
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

/**
 * Installs (or, with `replace`, updates) an extension from an upload whose
 * request body is the raw .zip file.
 * Throws a 409 CONFLICT when it already exists and `replace` is false, so the
 * UI can ask before overwriting.
 */
export async function installExtensionUpload(root: string, request: Request, replace: boolean, actorId: string) {
  await mkdir(root, { recursive: true });
  await sweepLeftovers(root);
  const archive = await receiveArchive(root, request);
  try {
    const reader = await ZipReader.open(archive);
    try {
      return await installFromArchive(root, reader, replace, actorId);
    } finally {
      // Closed before the archive is deleted: Windows can't remove an open file.
      await reader.close().catch(() => undefined);
    }
  } catch (err) {
    throw asInstallError(err);
  } finally {
    await rm(archive, { force: true }).catch(() => undefined);
  }
}

/** Deletes the extension's folder and its admin state. */
export async function uninstallExtensionFolder(id: string, dir: string, actorId: string) {
  await rm(dir, { recursive: true, force: true });
  await ExtensionState.deleteOne({ extensionId: id });
  clearExtensionBuildCache(dir);
  log("info", "extension uninstalled", { id, actorId });
}

/* -------------------------------------------------------------------------- */
/*                                   Export                                   */
/* -------------------------------------------------------------------------- */

/** Folders never included in an exported zip (dependencies and build caches). */
const EXPORT_SKIP = new Set(["node_modules", ".git", "target"]);

/**
 * Zips an installed extension so it can be shared or backed up.
 * Unlike install this builds the zip in memory, so it has its own, smaller
 * limit (`maxExportBytes`); larger extensions are copied from the folder.
 */
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
        if (total > EXTENSION_ZIP_LIMITS.maxExportBytes) {
          throw FlutterError.validation(
            `Extension is larger than ${formatExtensionLimit(EXTENSION_ZIP_LIMITS.maxExportBytes)}, too large to download as a .zip. Copy its folder from the panel host instead.`,
          );
        }
        out[relative(root, full).split(sep).join("/")] = new Uint8Array(await readFile(full));
      }
    }
  }

  await walk(root);
  return Buffer.from(zipSync(out, { level: 6 }));
}
