import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { unzipSync } from "fflate";
import { gunzipSync } from "node:zlib";
import type { DaemonConfig } from "./config";
import { bindPath, ensureServerOwnership, runBackupContainer, serverRoot } from "./docker";

const TEXT_LIMIT = 16 * 1024 * 1024;
const UPLOAD_LIMIT = 50 * 1024 * 1024;

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
  if (info.size > TEXT_LIMIT) throw new Error("File is larger than 16 MB");
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
    if (Buffer.byteLength(content) > TEXT_LIMIT) throw new Error("File is larger than 16 MB");
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
  if (buffer.length > UPLOAD_LIMIT) throw new Error("File is larger than 50 MB");

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

export function archiveKind(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tar.gz" as const;
  if (lower.endsWith(".tar")) return "tar" as const;
  if (lower.endsWith(".zip")) return "zip" as const;
  if (lower.endsWith(".gz")) return "gz" as const;
  return null;
}

export async function extractArchive(config: DaemonConfig, uuid: string, relPath: string) {
  const root = serverRoot(config, uuid);
  const archive = safeJoin(root, relPath);
  const info = await stat(archive);
  if (info.isDirectory()) throw new Error("Not an archive");
  const kind = archiveKind(archive);
  if (!kind) throw new Error("Unsupported archive. Use zip, tar, tar.gz, or gz.");

  const destDir = dirname(archive);
  if (kind === "zip") {
    await extractZip(root, archive, destDir);
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
