import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DaemonConfig } from "./config";
import { bindPath, runBackupContainer, serverRoot } from "./docker";

function backupRoot(config: DaemonConfig, uuid: string) {
  return resolve(config.dataDir, "backups", uuid);
}

export async function listBackups(config: DaemonConfig, uuid: string) {
  const dir = backupRoot(config, uuid);
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".tar.gz"));
  } catch {
    return [];
  }
  const rows = await Promise.all(
    names.map(async (name) => {
      const info = await stat(join(dir, name));
      return {
        id: name.replace(/\.tar\.gz$/, ""),
        name,
        size: info.size,
        createdAt: info.mtime.toISOString(),
      };
    }),
  );
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createBackup(config: DaemonConfig, uuid: string) {
  const id = randomUUID();
  const source = serverRoot(config, uuid);
  const destDir = backupRoot(config, uuid);
  await mkdir(source, { recursive: true });
  await mkdir(destDir, { recursive: true });
  await runBackupContainer(
    "alpine:3.20",
    [`${bindPath(source)}:/data`, `${bindPath(destDir)}:/out`],
    ["tar", "czf", `/out/${id}.tar.gz`, "-C", "/data", "."],
  );
  const info = await stat(join(destDir, `${id}.tar.gz`));
  return {
    id,
    name: `${id}.tar.gz`,
    size: info.size,
    createdAt: info.mtime.toISOString(),
  };
}

export async function deleteBackup(config: DaemonConfig, uuid: string, id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid backup id");
  await rm(join(backupRoot(config, uuid), `${id}.tar.gz`), { force: true });
  return { ok: true };
}

export async function restoreBackup(config: DaemonConfig, uuid: string, id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid backup id");
  const source = serverRoot(config, uuid);
  const destDir = backupRoot(config, uuid);
  await stat(join(destDir, `${id}.tar.gz`));
  await mkdir(source, { recursive: true });
  await runBackupContainer(
    "alpine:3.20",
    [`${bindPath(source)}:/data`, `${bindPath(destDir)}:/out`],
    ["tar", "xzf", `/out/${id}.tar.gz`, "-C", "/data"],
  );
  return { restored: true, id };
}
