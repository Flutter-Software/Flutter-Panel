import { generateKeyPairSync } from "node:crypto";
import { type Stats, constants as fsConstants } from "node:fs";
import { mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { DaemonConfig } from "./config";
import { ensureServerOwnership, serverRoot } from "./docker";
import { safeJoin } from "./files";
import { describeFetchError } from "./panel-fetch";
import { panelUrlCandidates } from "./heartbeat";

const { Server, utils } = createRequire(import.meta.url)("ssh2") as typeof import("ssh2");

const STATUS = utils.sftp.STATUS_CODE;
const OPEN = utils.sftp.OPEN_MODE;

type SftpAuth = { uuid: string; write: boolean; delete: boolean };

type FileOpen = { kind: "file"; handle: FileHandle; writable: boolean };
type DirOpen = {
  kind: "dir";
  names: { filename: string; longname: string; attrs: ReturnType<typeof attrsFrom> }[];
  sent: boolean;
};
type Opened = FileOpen | DirOpen;

function hostKeyPath(config: DaemonConfig) {
  return join(config.dataDir, "ssh_host_rsa");
}

async function loadHostKey(config: DaemonConfig) {
  const path = hostKeyPath(config);
  try {
    return await readFile(path);
  } catch {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, pem, { encoding: "utf8", mode: 0o600 });
    return Buffer.from(pem);
  }
}

function normalizeRel(input: string) {
  const parts: string[] = [];
  for (const part of (input || ".").replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("Path is outside the server directory");
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/") || ".";
}

function isMeta(rel: string) {
  return rel === ".flutter" || rel.startsWith(".flutter/");
}

async function resolvePath(root: string, input: string) {
  const rel = normalizeRel(input);
  if (isMeta(rel)) throw Object.assign(new Error("Not found"), { code: "ENOENT" });
  const target = safeJoin(root, rel);
  try {
    const real = await realpath(target);
    const base = await realpath(root).catch(() => resolve(root));
    if (real !== base && !real.startsWith(base + sep) && !real.startsWith(`${base}/`)) {
      throw Object.assign(new Error("Path is outside the server directory"), { code: "EACCES" });
    }
    return real;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return target;
    throw error;
  }
}

function displayFrom(root: string, target: string) {
  const rel = relative(resolve(root), target).replace(/\\/g, "/");
  return rel && rel !== "." ? `/${rel}` : "/";
}

function attrsFrom(info: Stats) {
  return {
    mode: info.mode,
    uid: 0,
    gid: 0,
    size: info.size,
    atime: Math.floor(info.atimeMs / 1000),
    mtime: Math.floor(info.mtimeMs / 1000),
  };
}

function longname(name: string, info: Stats) {
  const kind = info.isDirectory() ? "d" : "-";
  const size = String(info.size).padStart(8);
  const when = info.mtime.toISOString().slice(0, 16).replace("T", " ");
  return `${kind}rwxr-xr-x 1 flutter flutter ${size} ${when} ${name}`;
}

function openFlags(flags: number) {
  const read = Boolean(flags & OPEN.READ);
  const write = Boolean(flags & OPEN.WRITE);
  const append = Boolean(flags & OPEN.APPEND);
  const creat = Boolean(flags & OPEN.CREAT);
  const trunc = Boolean(flags & OPEN.TRUNC);
  const excl = Boolean(flags & OPEN.EXCL);
  let mode = read && write ? fsConstants.O_RDWR : write ? fsConstants.O_WRONLY : fsConstants.O_RDONLY;
  if (append) mode |= fsConstants.O_APPEND;
  if (creat) mode |= fsConstants.O_CREAT;
  if (trunc) mode |= fsConstants.O_TRUNC;
  if (excl) mode |= fsConstants.O_EXCL;
  return { flags: mode, writable: write || append };
}

function statusOf(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "ENOENT" || code === "ENOTDIR") return STATUS.NO_SUCH_FILE;
  if (code === "EACCES" || code === "EPERM" || code === "EEXIST") return STATUS.PERMISSION_DENIED;
  return STATUS.FAILURE;
}

async function withWritable<T>(config: DaemonConfig, uuid: string, action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || (error.code !== "EACCES" && error.code !== "EPERM")) {
      throw error;
    }
    await ensureServerOwnership(serverRoot(config, uuid), uuid);
    return action();
  }
}

async function authenticate(config: DaemonConfig, username: string, password: string): Promise<SftpAuth> {
  const errors: string[] = [];
  for (const panelUrl of panelUrlCandidates(config)) {
    const url = `${panelUrl.replace(/\/+$/, "")}/api/v1/daemon/sftp/auth`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.daemonToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ nodeId: config.nodeId, username, password }),
        signal: AbortSignal.timeout(12_000),
      });
      const json = (await response.json().catch(() => ({}))) as {
        data?: SftpAuth;
        error?: { message?: string };
      };
      if (!response.ok || !json.data?.uuid) {
        throw new Error(json.error?.message || `HTTP ${response.status}`);
      }
      return json.data;
    } catch (error) {
      errors.push(describeFetchError(error, url));
    }
  }
  throw new Error(errors[0] || "SFTP auth failed");
}

type SftpStream = {
  on(event: string, listener: (...args: never[]) => void): unknown;
  status(id: number, code: number): void;
  handle(id: number, handle: Buffer): void;
  data(id: number, data: Buffer): void;
  name(id: number, names: unknown[]): void;
  attrs(id: number, attrs: unknown): void;
};

function bindSftp(sftp: SftpStream, config: DaemonConfig, auth: SftpAuth) {
  const root = serverRoot(config, auth.uuid);
  const opens = new Map<string, Opened>();
  let next = 1;

  const keyOf = (handle: Buffer) => handle.toString("hex");
  const alloc = () => {
    const handle = Buffer.alloc(4);
    handle.writeUInt32BE(next);
    next += 1;
    return handle;
  };
  const deny = (id: number, allowed: boolean) => {
    if (allowed) return false;
    sftp.status(id, STATUS.PERMISSION_DENIED);
    return true;
  };
  const fail = (id: number, error: unknown) => {
    sftp.status(id, statusOf(error));
  };

  sftp.on("REALPATH", async (id: number, given: string) => {
    try {
      const target = await resolvePath(root, given || ".");
      const filename = displayFrom(root, target);
      const info = await stat(target).catch(() => null);
      sftp.name(id, [
        {
          filename,
          longname: filename,
          attrs: info ? attrsFrom(info) : { mode: 0o40755, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 },
        },
      ]);
    } catch (error) {
      fail(id, error);
    }
  });

  sftp.on("STAT", async (id: number, given: string) => {
    try {
      sftp.attrs(id, attrsFrom(await stat(await resolvePath(root, given))));
    } catch (error) {
      fail(id, error);
    }
  });

  sftp.on("LSTAT", async (id: number, given: string) => {
    try {
      sftp.attrs(id, attrsFrom(await stat(await resolvePath(root, given))));
    } catch (error) {
      fail(id, error);
    }
  });

  sftp.on("FSTAT", async (id: number, handle: Buffer) => {
    const opened = opens.get(keyOf(handle));
    if (!opened || opened.kind !== "file") {
      sftp.status(id, STATUS.FAILURE);
      return;
    }
    try {
      sftp.attrs(id, attrsFrom(await opened.handle.stat()));
    } catch (error) {
      fail(id, error);
    }
  });

  sftp.on("OPENDIR", async (id: number, given: string) => {
    try {
      const dir = await resolvePath(root, given);
      const info = await stat(dir);
      if (!info.isDirectory()) {
        sftp.status(id, STATUS.NO_SUCH_FILE);
        return;
      }
      const atRoot = resolve(dir) === resolve(root);
      const entries = await readdir(dir, { withFileTypes: true });
      const names = [];
      for (const entry of entries) {
        if (atRoot && entry.name === ".flutter") continue;
        try {
          const meta = await stat(join(dir, entry.name));
          names.push({
            filename: entry.name,
            longname: longname(entry.name, meta),
            attrs: attrsFrom(meta),
          });
        } catch {
          /* skip */
        }
      }
      const handle = alloc();
      opens.set(keyOf(handle), { kind: "dir", names, sent: false });
      sftp.handle(id, handle);
    } catch (error) {
      fail(id, error);
    }
  });

  sftp.on("READDIR", (id: number, handle: Buffer) => {
    const opened = opens.get(keyOf(handle));
    if (!opened || opened.kind !== "dir") {
      sftp.status(id, STATUS.FAILURE);
      return;
    }
    if (opened.sent) {
      sftp.status(id, STATUS.EOF);
      return;
    }
    opened.sent = true;
    sftp.name(id, opened.names);
  });

  sftp.on("OPEN", async (id: number, given: string, flags: number) => {
    const mode = openFlags(flags);
    if (mode.writable && deny(id, auth.write)) return;
    try {
      const target = await resolvePath(root, given);
      const existing = await stat(target).catch(() => null);
      if (existing?.isDirectory()) {
        sftp.status(id, STATUS.FAILURE);
        return;
      }
      const file = await withWritable(config, auth.uuid, () => open(target, mode.flags));
      const handle = alloc();
      opens.set(keyOf(handle), { kind: "file", handle: file, writable: mode.writable });
      sftp.handle(id, handle);
    } catch (error) {
      fail(id, error);
    }
  });

  sftp.on("READ", async (id: number, handle: Buffer, offset: bigint | number, length: number) => {
    const opened = opens.get(keyOf(handle));
    if (!opened || opened.kind !== "file") {
      sftp.status(id, STATUS.FAILURE);
      return;
    }
    try {
      const size = Math.min(Math.max(length, 0), 256 * 1024);
      const buffer = Buffer.alloc(size);
      const result = await opened.handle.read(buffer, 0, size, Number(offset));
      if (result.bytesRead <= 0) {
        sftp.status(id, STATUS.EOF);
        return;
      }
      sftp.data(id, buffer.subarray(0, result.bytesRead));
    } catch (error) {
      fail(id, error);
    }
  });

  sftp.on("WRITE", async (id: number, handle: Buffer, offset: bigint | number, data: Buffer) => {
    const opened = opens.get(keyOf(handle));
    if (!opened || opened.kind !== "file") {
      sftp.status(id, STATUS.FAILURE);
      return;
    }
    if (deny(id, auth.write && opened.writable)) return;
    try {
      await withWritable(config, auth.uuid, () => opened.handle.write(data, 0, data.length, Number(offset)));
      sftp.status(id, STATUS.OK);
    } catch (error) {
      fail(id, error);
    }
  });

  sftp.on("CLOSE", async (id: number, handle: Buffer) => {
    const opened = opens.get(keyOf(handle));
    opens.delete(keyOf(handle));
    try {
      if (opened?.kind === "file") await opened.handle.close();
      sftp.status(id, STATUS.OK);
    } catch (error) {
      fail(id, error);
    }
  });

  sftp.on("REMOVE", async (id: number, given: string) => {
    if (deny(id, auth.delete)) return;
    try {
      const target = await resolvePath(root, given);
      if (resolve(target) === resolve(root)) {
        sftp.status(id, STATUS.PERMISSION_DENIED);
        return;
      }
      await withWritable(config, auth.uuid, () => rm(target, { force: true }));
      sftp.status(id, STATUS.OK);
    } catch (error) {
      fail(id, error);
    }
  });

  sftp.on("RMDIR", async (id: number, given: string) => {
    if (deny(id, auth.delete)) return;
    try {
      const target = await resolvePath(root, given);
      if (resolve(target) === resolve(root)) {
        sftp.status(id, STATUS.PERMISSION_DENIED);
        return;
      }
      await withWritable(config, auth.uuid, () => rm(target, { recursive: true, force: true }));
      sftp.status(id, STATUS.OK);
    } catch (error) {
      fail(id, error);
    }
  });

  sftp.on("MKDIR", async (id: number, given: string) => {
    if (deny(id, auth.write)) return;
    try {
      const target = await resolvePath(root, given);
      await withWritable(config, auth.uuid, () => mkdir(target, { recursive: true }));
      sftp.status(id, STATUS.OK);
    } catch (error) {
      fail(id, error);
    }
  });

  sftp.on("RENAME", async (id: number, from: string, to: string) => {
    if (deny(id, auth.write)) return;
    try {
      const source = await resolvePath(root, from);
      const dest = await resolvePath(root, to);
      await withWritable(config, auth.uuid, async () => {
        await mkdir(dirname(dest), { recursive: true });
        await rename(source, dest);
      });
      sftp.status(id, STATUS.OK);
    } catch (error) {
      fail(id, error);
    }
  });

  sftp.on("SETSTAT", (id: number) => {
    if (deny(id, auth.write)) return;
    sftp.status(id, STATUS.OK);
  });
  sftp.on("FSETSTAT", (id: number) => {
    if (deny(id, auth.write)) return;
    sftp.status(id, STATUS.OK);
  });
  sftp.on("READLINK", (id: number) => sftp.status(id, STATUS.OP_UNSUPPORTED));
  sftp.on("SYMLINK", (id: number) => sftp.status(id, STATUS.OP_UNSUPPORTED));
}

export async function startSftp(config: DaemonConfig) {
  const hostKey = await loadHostKey(config);
  const server = new Server({ hostKeys: [hostKey], ident: "SSH-2.0-FlutterSFTP" }, (client) => {
    let auth: SftpAuth | null = null;
    client.on("authentication", (ctx) => {
      if (ctx.method !== "password") {
        ctx.reject(["password"]);
        return;
      }
      void authenticate(config, ctx.username, ctx.password)
        .then((result) => {
          auth = result;
          ctx.accept();
        })
        .catch(() => ctx.reject());
    });
    client.on("ready", () => {
      client.on("session", (accept, reject) => {
        if (!auth) {
          reject();
          return;
        }
        const granted = auth;
        const session = accept();
        session.on("sftp", (acceptSftp) => {
          bindSftp(acceptSftp() as SftpStream, config, granted);
        });
        session.on("pty", (_accept, deny) => deny());
        session.on("shell", (_accept, deny) => deny());
        session.on("exec", (_accept, deny) => deny());
      });
    });
    client.on("error", () => undefined);
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(config.sftpPort, config.listenHost, () => {
      server.removeListener("error", reject);
      console.log(
        JSON.stringify({
          level: "info",
          msg: "sftp listening",
          port: config.sftpPort,
          time: new Date().toISOString(),
        }),
      );
      resolveListen();
    });
  });
  return server;
}
