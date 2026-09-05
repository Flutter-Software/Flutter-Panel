import { FILE_OPEN_LIMIT_BYTES, FILE_UPLOAD_LIMIT_BYTES, formatUploadLimit } from "@flutter-software/shared";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { createExtractorFromData, UnrarError } from "node-unrar-js";
import { gunzipSync } from "node:zlib";
import type { DaemonConfig } from "./config";
import { bindPath, ensureServerOwnership, runBackupContainer, serverRoot } from "./docker";

export function safeJoin(root: string, rel: string) {
  const cleaned = (rel || ".").replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned.split("/").some((part) => part === "..")) {
    throw new Error("Path cannot contain ..");
  }
  const target = resolve(root, cleaned === "." ? "" : cleaned);
  const base = resolve(root);
  if (target !== base && !target.startsWith(base + sep) && !target.startsWith(`${base}/`)) {
    throw new Error("Path is outside the server directory");
  }
  return target;
}

function displayPath(root: string, target: string) {
  const rel = relative(root, target).replace(/\\/g, "/");
  return rel ? `/${rel}` : "/";
}

function isDenied(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error.code === "EACCES" || error.code === "EPERM"));
}

async function withWritable<T>(config: DaemonConfig, uuid: string, action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    if (!isDenied(error)) throw error;
    await ensureServerOwnership(serverRoot(config, uuid), uuid);
    return action();
  }
}

export async function listFiles(config: DaemonConfig, uuid: string, relPath: string) {
  const root = serverRoot(config, uuid);
  const dir = safeJoin(root, relPath);
  const info = await stat(dir);
  if (!info.isDirectory()) throw new Error("Not a directory");
  const entries = await readdir(dir, { withFileTypes: true });
  const atRoot = displayPath(root, dir) === "/";
  const rows = [];
  for (const entry of entries) {
    if (atRoot && entry.name === ".flutter") continue;
    const full = join(dir, entry.name);
    let size = 0;
    let modifiedAt = new Date().toISOString();
    try {
      const meta = await stat(full);
      size = entry.isDirectory() ? 0 : meta.size;
      modifiedAt = meta.mtime.toISOString();
    } catch {
      /* ignore */
    }
    rows.push({
      name: entry.name,
      kind: entry.isDirectory() ? ("dir" as const) : ("file" as const),
      size,
      modifiedAt,
    });
  }
  rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return { path: displayPath(root, dir), entries: rows };
}

export async function readServerFile(config: DaemonConfig, uuid: string, relPath: string) {
  const root = serverRoot(config, uuid);
  const target = safeJoin(root, relPath);
  const info = await stat(target);
  if (info.isDirectory()) throw new Error("Cannot read a directory");
  if (info.size > FILE_OPEN_LIMIT_BYTES) throw new Error("File is larger than 250 MB");
  const buffer = await readFile(target);
  if (buffer.includes(0)) throw new Error("Binary files cannot be edited in the panel");
  return { path: displayPath(root, target), content: buffer.toString("utf8"), size: info.size };
}

export async function writeServerFile(
  config: DaemonConfig,
  uuid: string,
  relPath: string,
  content: string,
) {
  const root = serverRoot(config, uuid);
  const target = safeJoin(root, relPath);
  return withWritable(config, uuid, async () => {
    if (Buffer.byteLength(content) > FILE_OPEN_LIMIT_BYTES) throw new Error("File is larger than 250 MB");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    return { path: displayPath(root, target), size: Buffer.byteLength(content) };
  });
}

export async function mkdirServer(config: DaemonConfig, uuid: string, relPath: string) {
  const root = serverRoot(config, uuid);
  const target = safeJoin(root, relPath);
  return withWritable(config, uuid, async () => {
    await mkdir(target, { recursive: true });
    return { path: displayPath(root, target) };
  });
}

export async function deleteServerPath(config: DaemonConfig, uuid: string, relPath: string) {
  const root = serverRoot(config, uuid);
  const target = safeJoin(root, relPath);
  if (target === resolve(root)) throw new Error("Cannot delete the server root");
  return withWritable(config, uuid, async () => {
    await rm(target, { recursive: true, force: true });
    return { path: displayPath(root, target) };
  });
}

export async function renameServerPath(
  config: DaemonConfig,
  uuid: string,
  from: string,
  to: string,
) {
  const root = serverRoot(config, uuid);
  const source = safeJoin(root, from);
  const dest = safeJoin(root, to);
  return withWritable(config, uuid, async () => {
    await mkdir(dirname(dest), { recursive: true });
    await rename(source, dest);
    return { from: displayPath(root, source), to: displayPath(root, dest) };
  });
}

export async function uploadServerFile(
  config: DaemonConfig,
  uuid: string,
  dir: string,
  name: string,
  contentBase64: string,
  maxBytes = FILE_UPLOAD_LIMIT_BYTES,
) {
  const fileName = name.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!fileName || fileName.split("/").some((part) => part === ".." || part === "")) {
    throw new Error("Invalid file name");
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(contentBase64, "base64");
  } catch {
    throw new Error("Invalid upload payload");
  }
  if (!buffer.length) throw new Error("File is empty");
  const limit = maxBytes > 0 ? maxBytes : FILE_UPLOAD_LIMIT_BYTES;
  if (buffer.length > limit) throw new Error(`File is larger than ${formatUploadLimit(limit)}`);

  const root = serverRoot(config, uuid);
  const rel = [dir.replace(/^\/+|\/+$/g, ""), fileName].filter(Boolean).join("/");
  const target = safeJoin(root, rel);
  if (resolve(target) === resolve(root)) throw new Error("Invalid file name");
  if (fileName.split("/")[0] === ".flutter") {
    throw new Error("Cannot write into .flutter");
  }
  return withWritable(config, uuid, async () => {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer);
    return { path: displayPath(root, target), size: buffer.length };
  });
}

function parseItemNames(names: unknown, emptyMessage: string) {
  if (!Array.isArray(names) || !names.length) throw new Error(emptyMessage);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = String(raw ?? "").trim();
    if (!name || name === "." || name === "..") throw new Error("Invalid file name");
    if (/[\\/]/.test(name)) throw new Error("Name cannot contain slashes");
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  if (!out.length) throw new Error(emptyMessage);
  if (out.length > 500) throw new Error("Too many items at once");
  return out;
}

function parseArchiveNames(names: unknown) {
  return parseItemNames(names, "Select files to archive");
}

function isMissing(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function unusedArchiveName(dir: string, stem: string) {
  const clean = stem.replace(/[\\/]/g, "").trim() || "archive";
  let n = 0;
  for (;;) {
    const name = n === 0 ? `${clean}.tar.gz` : `${clean}-${n}.tar.gz`;
    try {
      await stat(join(dir, name));
    } catch (error) {
      if (isMissing(error)) return name;
      throw error;
    }
    n += 1;
    if (n > 1000) throw new Error("Could not pick an archive name");
  }
}

export async function compressArchive(
  config: DaemonConfig,
  uuid: string,
  relDir: string,
  names: unknown,
) {
  const items = parseArchiveNames(names);
  const root = serverRoot(config, uuid);
  const dir = safeJoin(root, relDir);
  const info = await stat(dir);
  if (!info.isDirectory()) throw new Error("Not a directory");
  const atRoot = displayPath(root, dir) === "/";

  const sources: string[] = [];
  for (const name of items) {
    if (atRoot && name === ".flutter") throw new Error("Cannot archive .flutter");
    const rel = [relDir.replace(/^\/+|\/+$/g, ""), name].filter(Boolean).join("/");
    const target = safeJoin(root, rel);
    try {
      await stat(target);
    } catch (error) {
      if (isMissing(error)) throw new Error(`${name} was not found`);
      throw error;
    }
    sources.push(name.startsWith("-") ? `./${name}` : name);
  }

  const stem = items.length === 1 ? items[0] : "archive";
  const archiveName = await unusedArchiveName(dir, stem);
  const destRel = relative(root, dir).replace(/\\/g, "/");
  const destMount = destRel ? `/data/${destRel}` : "/data";

  return withWritable(config, uuid, async () => {
    try {
      await runBackupContainer(
        "alpine:3.20",
        [`${bindPath(root)}:/data`],
        ["tar", "czf", `${destMount}/${archiveName}`, "-C", destMount, ...sources],
      );
    } catch (error) {
      const detail = error instanceof Error && error.message ? error.message : "unknown error";
      throw new Error(`Could not create the archive (${detail})`);
    }
    const archivePath = join(dir, archiveName);
    const meta = await stat(archivePath);
    return { path: displayPath(root, archivePath), size: meta.size };
  });
}

export function archiveKind(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tar.gz" as const;
  if (lower.endsWith(".tar")) return "tar" as const;
  if (lower.endsWith(".zip")) return "zip" as const;
  if (lower.endsWith(".rar")) return "rar" as const;
  if (lower.endsWith(".gz")) return "gz" as const;
  return null;
}

export async function extractArchive(config: DaemonConfig, uuid: string, relPath: string) {
  const root = serverRoot(config, uuid);
  const archive = safeJoin(root, relPath);
  const info = await stat(archive);
  if (info.isDirectory()) throw new Error("Not an archive");
  const kind = archiveKind(archive);
  if (!kind) throw new Error("Unsupported archive. Use zip, rar, tar, tar.gz, or gz.");

  const destDir = dirname(archive);
  if (kind === "zip") {
    await extractZip(root, archive, destDir);
  } else if (kind === "rar") {
    await extractRar(root, archive, destDir);
  } else if (kind === "gz") {
    const outName = archive.replace(/\.gz$/i, "");
    if (outName === archive) throw new Error("Cannot determine output name");
    const out = safeJoin(root, relative(root, outName).replace(/\\/g, "/"));
    await writeFile(out, gunzipSync(await readFile(archive)));
  } else {
    const rel = relative(root, archive).replace(/\\/g, "/");
    const destRel = relative(root, destDir).replace(/\\/g, "/");
    const destMount = destRel ? `/data/${destRel}` : "/data";
    await runBackupContainer(
      "alpine:3.20",
      [`${bindPath(root)}:/data`],
      ["tar", kind === "tar.gz" ? "xzf" : "xf", `/data/${rel}`, "-C", destMount],
    );
  }
  return { path: displayPath(root, destDir), extracted: true };
}

async function extractZip(root: string, archive: string, destDir: string) {
  const unzipped = unzipSync(new Uint8Array(await readFile(archive)));
  let count = 0;
  for (const [entryName, data] of Object.entries(unzipped)) {
    const name = entryName.replace(/\\/g, "/");
    if (!name || name.endsWith("/")) continue;
    const destRel = [relative(root, destDir).replace(/\\/g, "/"), name].filter(Boolean).join("/");
    const dest = safeJoin(root, destRel);
    if (resolve(destDir) === resolve(root) && name.split("/")[0] === ".flutter") continue;
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(data));
    count += 1;
  }
  if (!count) throw new Error("Archive did not contain any files");
}

async function extractRar(root: string, archive: string, destDir: string) {
  const buf = await readFile(archive);
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  let extractor;
  try {
    extractor = await createExtractorFromData({ data });
  } catch (error) {
    throw rarError(error);
  }

  let count = 0;
  try {
    for (const file of extractor.extract().files) {
      const header = file.fileHeader;
      if (header.flags.encrypted) {
        throw new Error("Password-protected RAR archives are not supported");
      }
      if (header.flags.directory) continue;
      const name = header.name.replace(/\\/g, "/");
      if (!name || name.endsWith("/")) continue;
      const destRel = [relative(root, destDir).replace(/\\/g, "/"), name].filter(Boolean).join("/");
      const dest = safeJoin(root, destRel);
      if (resolve(destDir) === resolve(root) && name.split("/")[0] === ".flutter") continue;
      if (!file.extraction) continue;
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, Buffer.from(file.extraction));
      count += 1;
    }
  } catch (error) {
    throw rarError(error);
  }
  if (!count) throw new Error("Archive did not contain any files");
}

function rarError(error: unknown) {
  if (error instanceof Error && !(error instanceof UnrarError)) return error;
  const reason = error instanceof UnrarError ? error.reason : "";
  if (reason === "ERAR_MISSING_PASSWORD" || reason === "ERAR_BAD_PASSWORD") {
    return new Error("Password-protected RAR archives are not supported");
  }
  if (reason === "ERAR_BAD_ARCHIVE" || reason === "ERAR_UNKNOWN_FORMAT") {
    return new Error("Not a valid RAR archive");
  }
  if (error instanceof Error && error.message) return new Error(error.message);
  return new Error("Could not extract RAR archive");
}

const SEARCH_MAX_HITS = 200;
const SEARCH_MAX_VISIT = 2000;
const SEARCH_MAX_DEPTH = 20;
const ZIP_MAX_FILES = 5000;

export async function statServerPath(config: DaemonConfig, uuid: string, relPath: string) {
  const root = serverRoot(config, uuid);
  const target = safeJoin(root, relPath);
  const info = await stat(target);
  return {
    path: displayPath(root, target),
    kind: info.isDirectory() ? ("dir" as const) : ("file" as const),
    size: info.isDirectory() ? 0 : info.size,
  };
}

export async function searchFiles(config: DaemonConfig, uuid: string, relPath: string, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) throw new Error("Enter a search");
  if (q.length > 200) throw new Error("Search is too long");

  const root = serverRoot(config, uuid);
  const start = safeJoin(root, relPath);
  const info = await stat(start);
  if (!info.isDirectory()) throw new Error("Not a directory");

  const matches: { path: string; name: string; kind: "file" | "dir"; size: number }[] = [];
  let visited = 0;

  async function walk(dir: string, depth: number) {
    if (matches.length >= SEARCH_MAX_HITS || visited >= SEARCH_MAX_VISIT || depth > SEARCH_MAX_DEPTH) return;
    const atRoot = displayPath(root, dir) === "/";
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= SEARCH_MAX_HITS || visited >= SEARCH_MAX_VISIT) return;
      if (atRoot && entry.name === ".flutter") continue;
      visited += 1;
      const full = join(dir, entry.name);
      if (entry.name.toLowerCase().includes(q)) {
        let size = 0;
        try {
          const meta = await stat(full);
          size = entry.isDirectory() ? 0 : meta.size;
        } catch {
          /* ignore */
        }
        matches.push({
          path: displayPath(root, full),
          name: entry.name,
          kind: entry.isDirectory() ? "dir" : "file",
          size,
        });
      }
      if (entry.isDirectory()) await walk(full, depth + 1);
    }
  }

  await walk(start, 0);
  return {
    path: displayPath(root, start),
    query: q,
    matches,
    truncated: matches.length >= SEARCH_MAX_HITS || visited >= SEARCH_MAX_VISIT,
  };
}

function safeDownloadName(name: string) {
  const base = name.replace(/[\r\n"/\\]/g, "_").trim() || "download";
  return base.slice(0, 180);
}

async function fileDownload(abs: string, filename: string, size: number) {
  if (size > FILE_OPEN_LIMIT_BYTES) throw new Error("File is larger than 250 MB");
  return {
    filename: safeDownloadName(filename),
    mime: "application/octet-stream",
    body: await readFile(abs),
  };
}

async function collectZip(
  root: string,
  abs: string,
  zipName: string,
  acc: { files: Record<string, Uint8Array>; bytes: number; count: number },
) {
  if (acc.count >= ZIP_MAX_FILES) throw new Error("Too many files to download at once");
  const info = await stat(abs);
  if (info.isDirectory()) {
    const atRoot = displayPath(root, abs) === "/";
    const entries = await readdir(abs, { withFileTypes: true });
    for (const entry of entries) {
      if (atRoot && entry.name === ".flutter") continue;
      const child = zipName ? `${zipName}/${entry.name}` : entry.name;
      await collectZip(root, join(abs, entry.name), child, acc);
    }
    return;
  }
  if (acc.bytes + info.size > FILE_OPEN_LIMIT_BYTES) throw new Error("Download is larger than 250 MB");
  acc.files[zipName] = new Uint8Array(await readFile(abs));
  acc.bytes += info.size;
  acc.count += 1;
}

async function zipDownload(root: string, targets: { abs: string; zipName: string }[], zipName: string) {
  const acc = { files: {} as Record<string, Uint8Array>, bytes: 0, count: 0 };
  for (const target of targets) {
    await collectZip(root, target.abs, target.zipName, acc);
  }
  if (!acc.count) throw new Error("Nothing to download");
  const zipped = zipSync(acc.files, { level: 6 });
  return {
    filename: safeDownloadName(zipName),
    mime: "application/zip",
    body: Buffer.from(zipped),
  };
}

export async function downloadServer(config: DaemonConfig, uuid: string, relPath: string, names: unknown) {
  const root = serverRoot(config, uuid);
  const items = Array.isArray(names) && names.length ? parseItemNames(names, "Select files to download") : null;

  if (!items) {
    const target = safeJoin(root, relPath);
    const info = await stat(target);
    const shown = displayPath(root, target);
    if (info.isDirectory()) {
      if (shown === "/") throw new Error("Select files to download");
      return zipDownload(root, [{ abs: target, zipName: basename(target) }], `${basename(target)}.zip`);
    }
    return fileDownload(target, basename(target), info.size);
  }

  const dir = safeJoin(root, relPath);
  const dirInfo = await stat(dir);
  if (!dirInfo.isDirectory()) throw new Error("Not a directory");
  const atRoot = displayPath(root, dir) === "/";

  const targets: { abs: string; zipName: string }[] = [];
  for (const name of items) {
    if (atRoot && name === ".flutter") throw new Error("Cannot download .flutter");
    const rel = [relPath.replace(/^\/+|\/+$/g, ""), name].filter(Boolean).join("/");
    const abs = safeJoin(root, rel);
    try {
      await stat(abs);
    } catch (error) {
      if (isMissing(error)) throw new Error(`${name} was not found`);
      throw error;
    }
    targets.push({ abs, zipName: name });
  }

  if (targets.length === 1) {
    const info = await stat(targets[0].abs);
    if (!info.isDirectory()) return fileDownload(targets[0].abs, targets[0].zipName, info.size);
  }

  const zipName = targets.length === 1 ? `${targets[0].zipName}.zip` : "files.zip";
  return zipDownload(root, targets, zipName);
}
