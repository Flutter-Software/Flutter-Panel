/**
 * The node's SFTP server.
 *
 * One listener serves every game server on the node. A login is
 * `<panel username>.<server uuid>` plus the panel password; the panel checks
 * the credentials and answers with what the user may do (`SftpAuth`). The
 * session is then jailed to that server's directory.
 *
 * Error handling, top to bottom:
 *
 *   handler throws ─▶ classify() ─▶ SFTP status + a readable message
 *                              ├─▶ node log   (everything but "not found")
 *                              └─▶ telemetry  (via the panel; see error-report.ts)
 *
 * SFTP v3 has only a handful of status codes, and most real failures collapse
 * into the generic FAILURE (4). Clients such as WinSCP then show a list of
 * guesses unless the server also sends a message, so every status this module
 * sends carries one that says what actually went wrong.
 */
import { generateKeyPairSync } from "node:crypto";
import { type Stats, constants as fsConstants } from "node:fs";
import { mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { DaemonConfig } from "./config";
import { DiskLimitError, ensureDiskCapacity, ensureServerOwnership, serverRoot } from "./docker";
import { reportDaemonError } from "./error-report";
import { safeJoin } from "./files";
import { describeFetchError } from "./panel-fetch";
import { panelUrlCandidates } from "./heartbeat";

const { Server, utils } = createRequire(import.meta.url)("ssh2") as typeof import("ssh2");

const STATUS = utils.sftp.STATUS_CODE;
const OPEN = utils.sftp.OPEN_MODE;

/** Identical failures (same operation and code) in one session are logged once per window. */
const LOG_REPEAT_MS = 5_000;

type SftpAuth = { uuid: string; write: boolean; delete: boolean };

type FileOpen = {
  kind: "file";
  handle: FileHandle;
  writable: boolean;
  /**
   * Highest byte offset this handle has been asked to write up to (starts at
   * the file's size when opened). Disk-limit checks charge only the bytes past
   * this mark. It is advanced synchronously, before the write is awaited,
   * because clients pipeline many WRITE requests: measuring against the file's
   * size on disk would count the not-yet-flushed chunks again for every
   * request and report a false "disk full" near the limit.
   */
  size: number;
};
type DirOpen = {
  kind: "dir";
  names: { filename: string; longname: string; attrs: ReturnType<typeof attrsFrom> }[];
  sent: boolean;
};
type Opened = FileOpen | DirOpen;

/**
 * An error raised by this module (rather than by the filesystem) for a
 * condition it detects itself. `code` is errno-style so `classify` can treat
 * both kinds the same way.
 */
class SftpError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SftpError";
  }
}

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

/** Collapse `.` and `..` in a client path. Climbing above the root is refused. */
function normalizeRel(input: string) {
  const parts: string[] = [];
  for (const part of (input || ".").replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new SftpError("EOUTSIDE", "Path is outside the server directory");
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/") || ".";
}

/** `.flutter/` holds the panel's own files for the server and is hidden from SFTP. */
function isMeta(rel: string) {
  return rel === ".flutter" || rel.startsWith(".flutter/");
}

/**
 * Turn a client path into an absolute path inside the server's directory.
 * Symlinks are resolved so a link pointing out of the directory cannot be
 * followed. A path that does not exist yet is returned unresolved (it is about
 * to be created).
 */
async function resolvePath(root: string, input: string) {
  const rel = normalizeRel(input);
  if (isMeta(rel)) throw new SftpError("ENOENT", "Not found");
  let target: string;
  try {
    target = safeJoin(root, rel);
  } catch {
    throw new SftpError("EOUTSIDE", "Path is outside the server directory");
  }
  try {
    const real = await realpath(target);
    const base = await realpath(root).catch(() => resolve(root));
    if (real !== base && !real.startsWith(base + sep) && !real.startsWith(`${base}/`)) {
      throw new SftpError("EOUTSIDE", "Path is outside the server directory");
    }
    return real;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return target;
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

/** The errno-style `code` of an error, or "" when it has none. */
function errorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

type Failure = {
  /** SFTP status code sent to the client. */
  status: number;
  /** Stable code used for logs, throttling and telemetry grouping. */
  code: string;
  /** Message shown by the client. Never contains a host path. */
  message: string;
  /** Whether to send this to telemetry. False for ordinary user mistakes. */
  report: boolean;
  /** True for errors this table does not know: likely a bug, so keep the stack. */
  unexpected: boolean;
};

type FailureRule = Pick<Failure, "status" | "message" | "report">;

/**
 * How each known error is presented. `report` is true for conditions an
 * operator should hear about (disk, permissions, resource exhaustion) and
 * false for things the user did (wrong name, file in use).
 */
const FAILURE_RULES: Record<string, FailureRule> = {
  ENOENT: { status: STATUS.NO_SUCH_FILE, message: "No such file or folder.", report: false },
  ENOTDIR: { status: STATUS.NO_SUCH_FILE, message: "Part of the path is a file, not a folder.", report: false },
  EOUTSIDE: {
    status: STATUS.PERMISSION_DENIED,
    message: "That path is outside this server's files.",
    report: false,
  },
  EACCES: {
    status: STATUS.PERMISSION_DENIED,
    message: "The node could not access that file (file ownership on the node is wrong).",
    report: true,
  },
  EPERM: {
    status: STATUS.PERMISSION_DENIED,
    message: "The node was not allowed to change that file. It may be in use or read-only.",
    report: true,
  },
  EEXIST: { status: STATUS.FAILURE, message: "A file or folder with that name already exists.", report: false },
  EISDIR: { status: STATUS.FAILURE, message: "That name belongs to a folder, not a file.", report: false },
  ERR_FS_EISDIR: { status: STATUS.FAILURE, message: "That name belongs to a folder, not a file.", report: false },
  ENOTEMPTY: {
    status: STATUS.FAILURE,
    message: "A folder with that name already exists there and is not empty.",
    report: false,
  },
  EINVAL: { status: STATUS.FAILURE, message: "That operation is not valid for this file or folder.", report: false },
  EBUSY: {
    status: STATUS.FAILURE,
    message: "The file is in use, probably by the running server. Stop the server and try again.",
    report: false,
  },
  ETXTBSY: {
    status: STATUS.FAILURE,
    message: "The file is in use, probably by the running server. Stop the server and try again.",
    report: false,
  },
  ENAMETOOLONG: { status: STATUS.FAILURE, message: "The file name or path is too long.", report: false },
  ELOOP: { status: STATUS.FAILURE, message: "Too many symbolic links in that path.", report: false },
  DISK_LIMIT: {
    status: STATUS.FAILURE,
    message: "This server's disk limit is reached. Delete some files or ask an admin to raise the limit.",
    report: true,
  },
  ENOSPC: {
    status: STATUS.FAILURE,
    message: "The node's disk is full. Contact an admin.",
    report: true,
  },
  EDQUOT: {
    status: STATUS.FAILURE,
    message: "The node's disk quota is exceeded. Contact an admin.",
    report: true,
  },
  EXDEV: {
    status: STATUS.FAILURE,
    message: "Cannot move between different disks on the node. Download and re-upload the file instead.",
    report: true,
  },
  EMFILE: {
    status: STATUS.FAILURE,
    message: "The node has too many files open. Wait a moment and try again.",
    report: true,
  },
  ENFILE: {
    status: STATUS.FAILURE,
    message: "The node has too many files open. Wait a moment and try again.",
    report: true,
  },
  EROFS: { status: STATUS.FAILURE, message: "The node's disk is read-only. Contact an admin.", report: true },
  EIO: { status: STATUS.FAILURE, message: "The node's disk reported an I/O error. Contact an admin.", report: true },
  EBADHANDLE: {
    status: STATUS.FAILURE,
    message: "That file is no longer open. Reconnect and try again.",
    report: false,
  },
};

/** Decide what a thrown error means for the client, the log and telemetry. */
function classify(error: unknown): Failure {
  // DiskLimitError also carries code ENOSPC; tell the server's own limit apart
  // from the node's physical disk, because the fix is different.
  const code = error instanceof DiskLimitError ? "DISK_LIMIT" : errorCode(error);
  const rule = FAILURE_RULES[code];
  if (rule) return { ...rule, code, unexpected: false };
  return {
    status: STATUS.FAILURE,
    code: code || "UNKNOWN",
    message: `The node could not complete that (${code || "unexpected error"}). Try again, or contact an admin.`,
    report: true,
    unexpected: true,
  };
}

/** One structured line in the daemon log, same shape as the rest of the daemon. */
function logSftp(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ level, msg, ...extra, time: new Date().toISOString() }));
}

/**
 * Run a filesystem action, and if the node itself lacks permission, fix the
 * server directory's ownership once and retry. Files written by the game
 * container can end up owned by a different user than the daemon.
 */
async function withWritable<T>(config: DaemonConfig, uuid: string, action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    const code = errorCode(error);
    if (code !== "EACCES" && code !== "EPERM") throw error;
    await ensureServerOwnership(serverRoot(config, uuid), uuid);
    return action();
  }
}

/**
 * Why a login failed. `rejected` means the panel answered and said no (bad
 * password, no access, maintenance); otherwise the panel could not be reached.
 */
class SftpAuthError extends Error {
  constructor(
    message: string,
    readonly rejected: boolean,
  ) {
    super(message);
    this.name = "SftpAuthError";
  }
}

async function authenticate(config: DaemonConfig, username: string, password: string): Promise<SftpAuth> {
  const errors: string[] = [];
  for (const panelUrl of panelUrlCandidates(config)) {
    const url = `${panelUrl.replace(/\/+$/, "")}/api/v1/daemon/sftp/auth`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.daemonToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ nodeId: config.nodeId, username, password }),
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      // Network failure: this candidate URL is wrong or the panel is down.
      errors.push(describeFetchError(error, url));
      continue;
    }
    const json = (await response.json().catch(() => ({}))) as {
      data?: SftpAuth;
      error?: { message?: string };
    };
    if (response.ok && json.data?.uuid) return json.data;
    const message = json.error?.message || `HTTP ${response.status}`;
    // The panel answered and refused (4xx, or a panel error body such as the
    // 503 for maintenance mode). Every candidate is the same panel, so asking
    // the others would only repeat the password check. A 5xx with no panel
    // error body is a proxy in front of a panel that is down: keep trying.
    if (response.status < 500 || json.error?.message) throw new SftpAuthError(message, true);
    errors.push(`${message} [${url}]`);
  }
  throw new SftpAuthError(errors[0] || "SFTP auth failed", false);
}

type SftpStream = {
  on(event: string, listener: (...args: never[]) => void): unknown;
  status(id: number, code: number, message?: string): void;
  handle(id: number, handle: Buffer): void;
  data(id: number, data: Buffer): void;
  name(id: number, names: unknown[]): void;
  attrs(id: number, attrs: unknown): void;
};

/**
 * Wire one SFTP session to a server's directory.
 * Returns a function that releases everything the session still holds open;
 * call it when the connection ends.
 */
function bindSftp(sftp: SftpStream, config: DaemonConfig, auth: SftpAuth) {
  const root = serverRoot(config, auth.uuid);
  const opens = new Map<string, Opened>();
  /** Last log time and swallowed repeats per `op|code`, for this session. */
  const logged = new Map<string, { at: number; repeats: number }>();
  let next = 1;

  const keyOf = (handle: Buffer) => handle.toString("hex");
  const alloc = () => {
    const handle = Buffer.alloc(4);
    handle.writeUInt32BE(next);
    next += 1;
    return handle;
  };

  /**
   * Send a reply, ignoring a stream that has already gone away. A client that
   * disconnects mid-transfer must not turn into an unhandled rejection.
   */
  const reply = (send: () => void) => {
    try {
      send();
    } catch {
      /* connection closed */
    }
  };
  const ok = (id: number) => reply(() => sftp.status(id, STATUS.OK));

  /** Translate a thrown error into a status for the client, a log line and a report. */
  const fail = (op: string, id: number, error: unknown) => {
    const failure = classify(error);
    reply(() => sftp.status(id, failure.status, failure.message));

    // Clients probe for files that do not exist all the time; that is not news.
    if (failure.status === STATUS.NO_SUCH_FILE) return;
    const raw = error instanceof Error ? error.message : String(error);
    // A failed upload fails every pipelined WRITE at once. Log the first and
    // fold the rest into a count on the next line for the same op and code.
    const key = `${op}|${failure.code}`;
    const now = Date.now();
    const seen = logged.get(key);
    if (seen && now - seen.at < LOG_REPEAT_MS) {
      seen.repeats += 1;
    } else {
      logSftp(failure.report ? "warn" : "info", "sftp operation failed", {
        op,
        code: failure.code,
        server: auth.uuid,
        error: raw,
        ...(seen?.repeats ? { repeatsSinceLast: seen.repeats } : {}),
      });
      logged.set(key, { at: now, repeats: 0 });
    }
    if (!failure.report) return;
    reportDaemonError(config, {
      kind: "sftp",
      op,
      code: failure.code,
      name: error instanceof Error ? error.name : "Error",
      message: `SFTP ${op} failed: ${raw}`,
      // A stack only helps for errors we did not anticipate.
      stack: failure.unexpected && error instanceof Error ? error.stack : undefined,
    });
  };

  /** Refuse an operation the user's role does not allow. Returns true when refused. */
  const deny = (id: number, allowed: boolean, what: string) => {
    if (allowed) return false;
    reply(() => sftp.status(id, STATUS.PERMISSION_DENIED, `Your account is not allowed to ${what} on this server.`));
    return true;
  };

  /**
   * Register a request handler. Anything it throws, synchronously or not, is
   * answered through `fail`, so no request is ever left without a reply.
   */
  const on = <A extends unknown[]>(op: string, handler: (id: number, ...args: A) => void | Promise<void>) => {
    const listener = (id: number, ...args: A) => {
      void (async () => {
        try {
          await handler(id, ...args);
        } catch (error) {
          fail(op, id, error);
        }
      })();
    };
    // ssh2's emitter is typed per event; the argument tuple is supplied by `A`.
    sftp.on(op, listener as unknown as (...args: never[]) => void);
  };

  /** Look up an open file handle or throw the error for a stale one. */
  const fileOf = (handle: Buffer): FileOpen => {
    const opened = opens.get(keyOf(handle));
    if (!opened || opened.kind !== "file") throw new SftpError("EBADHANDLE", "Unknown file handle");
    return opened;
  };

  on<[string]>("REALPATH", async (id, given) => {
    const target = await resolvePath(root, given || ".");
    const filename = displayFrom(root, target);
    const info = await stat(target).catch(() => null);
    reply(() =>
      sftp.name(id, [
        {
          filename,
          longname: filename,
          attrs: info ? attrsFrom(info) : { mode: 0o40755, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 },
        },
      ]),
    );
  });

  on<[string]>("STAT", async (id, given) => {
    const attrs = attrsFrom(await stat(await resolvePath(root, given)));
    reply(() => sftp.attrs(id, attrs));
  });

  // Symlinks are not exposed (SYMLINK/READLINK are unsupported), so LSTAT
  // answers the same as STAT.
  on<[string]>("LSTAT", async (id, given) => {
    const attrs = attrsFrom(await stat(await resolvePath(root, given)));
    reply(() => sftp.attrs(id, attrs));
  });

  on<[Buffer]>("FSTAT", async (id, handle) => {
    const attrs = attrsFrom(await fileOf(handle).handle.stat());
    reply(() => sftp.attrs(id, attrs));
  });

  on<[string]>("OPENDIR", async (id, given) => {
    const dir = await resolvePath(root, given);
    const info = await stat(dir);
    if (!info.isDirectory()) throw new SftpError("ENOTDIR", "Not a directory");
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
        /* entry vanished or is a broken link: leave it out of the listing */
      }
    }
    const handle = alloc();
    opens.set(keyOf(handle), { kind: "dir", names, sent: false });
    reply(() => sftp.handle(id, handle));
  });

  on<[Buffer]>("READDIR", (id, handle) => {
    const opened = opens.get(keyOf(handle));
    if (!opened || opened.kind !== "dir") throw new SftpError("EBADHANDLE", "Unknown directory handle");
    if (opened.sent) {
      reply(() => sftp.status(id, STATUS.EOF));
      return;
    }
    opened.sent = true;
    reply(() => sftp.name(id, opened.names));
  });

  on<[string, number]>("OPEN", async (id, given, flags) => {
    const mode = openFlags(flags);
    if (mode.writable && deny(id, auth.write, "upload or edit files")) return;
    const target = await resolvePath(root, given);
    const existing = await stat(target).catch(() => null);
    if (existing?.isDirectory()) throw new SftpError("EISDIR", "Target is a directory");
    // Refuse before creating an empty file when the server is already full.
    if (mode.writable) await ensureDiskCapacity(config, auth.uuid, existing ? 0 : 1);
    const file = await withWritable(config, auth.uuid, () => open(target, mode.flags));
    let size: number;
    try {
      // After the open, so a truncating open starts from zero.
      size = (await file.stat()).size;
    } catch (error) {
      await file.close().catch(() => undefined);
      throw error;
    }
    const handle = alloc();
    opens.set(keyOf(handle), { kind: "file", handle: file, writable: mode.writable, size });
    reply(() => sftp.handle(id, handle));
  });

  on<[Buffer, bigint | number, number]>("READ", async (id, handle, offset, length) => {
    const opened = fileOf(handle);
    const size = Math.min(Math.max(length, 0), 256 * 1024);
    const buffer = Buffer.alloc(size);
    const result = await opened.handle.read(buffer, 0, size, Number(offset));
    if (result.bytesRead <= 0) {
      reply(() => sftp.status(id, STATUS.EOF));
      return;
    }
    reply(() => sftp.data(id, buffer.subarray(0, result.bytesRead)));
  });

  on<[Buffer, bigint | number, Buffer]>("WRITE", async (id, handle, offset, data) => {
    const opened = fileOf(handle);
    if (deny(id, auth.write && opened.writable, "upload or edit files")) return;
    const end = Number(offset) + data.length;
    // Charge only the bytes that grow the file, and claim them before the
    // first await so pipelined writes do not each count the same growth.
    const growth = Math.max(0, end - opened.size);
    opened.size = Math.max(opened.size, end);
    await ensureDiskCapacity(config, auth.uuid, growth);
    await withWritable(config, auth.uuid, () => opened.handle.write(data, 0, data.length, Number(offset)));
    ok(id);
  });

  on<[Buffer]>("CLOSE", async (id, handle) => {
    const opened = opens.get(keyOf(handle));
    opens.delete(keyOf(handle));
    if (opened?.kind === "file") await opened.handle.close();
    ok(id);
  });

  on<[string]>("REMOVE", async (id, given) => {
    if (deny(id, auth.delete, "delete files")) return;
    const target = await resolvePath(root, given);
    if (resolve(target) === resolve(root)) throw new SftpError("EOUTSIDE", "Cannot remove the server directory");
    await withWritable(config, auth.uuid, () => rm(target, { force: true }));
    ok(id);
  });

  on<[string]>("RMDIR", async (id, given) => {
    if (deny(id, auth.delete, "delete files")) return;
    const target = await resolvePath(root, given);
    if (resolve(target) === resolve(root)) throw new SftpError("EOUTSIDE", "Cannot remove the server directory");
    await withWritable(config, auth.uuid, () => rm(target, { recursive: true, force: true }));
    ok(id);
  });

  on<[string]>("MKDIR", async (id, given) => {
    if (deny(id, auth.write, "create folders")) return;
    const target = await resolvePath(root, given);
    await withWritable(config, auth.uuid, () => mkdir(target, { recursive: true }));
    ok(id);
  });

  on<[string, string]>("RENAME", async (id, from, to) => {
    if (deny(id, auth.write, "move or rename files")) return;
    const source = await resolvePath(root, from);
    const dest = await resolvePath(root, to);
    if (resolve(source) === resolve(root)) throw new SftpError("EOUTSIDE", "Cannot move the server directory");
    if (source === dest) {
      ok(id);
      return;
    }

    // Check the cases the OS reports badly ourselves. `rename` onto a folder
    // gives EISDIR on Linux but a bare EPERM on Windows, which would read as a
    // permissions problem and trigger a pointless ownership repair.
    const sourceInfo = await stat(source);
    const destInfo = await stat(dest).catch(() => null);
    if (sourceInfo.isDirectory() && (dest + sep).startsWith(source + sep)) {
      throw new SftpError("EINVAL", "Cannot move a folder into itself");
    }
    if (destInfo?.isDirectory()) {
      if (!sourceInfo.isDirectory()) throw new SftpError("EISDIR", "Destination is a directory");
      if ((await readdir(dest)).length) throw new SftpError("ENOTEMPTY", "Destination directory is not empty");
    } else if (destInfo && sourceInfo.isDirectory()) {
      throw new SftpError("ENOTDIR", "Destination is a file");
    }

    await withWritable(config, auth.uuid, async () => {
      await mkdir(dirname(dest), { recursive: true });
      await rename(source, dest);
    });
    ok(id);
  });

  // Ownership, permissions and timestamps are managed by the node. Accept the
  // request so clients that set them after an upload do not report a failure.
  on<[]>("SETSTAT", (id) => {
    if (deny(id, auth.write, "change files")) return;
    ok(id);
  });
  on<[]>("FSETSTAT", (id) => {
    if (deny(id, auth.write, "change files")) return;
    ok(id);
  });
  on<[]>("READLINK", (id) =>
    reply(() => sftp.status(id, STATUS.OP_UNSUPPORTED, "Symbolic links are not supported.")),
  );
  on<[]>("SYMLINK", (id) =>
    reply(() => sftp.status(id, STATUS.OP_UNSUPPORTED, "Symbolic links are not supported.")),
  );

  /** Close every file the session left open (client vanished mid-transfer). */
  return function dispose() {
    for (const opened of opens.values()) {
      if (opened.kind === "file") void opened.handle.close().catch(() => undefined);
    }
    opens.clear();
  };
}

export async function startSftp(config: DaemonConfig) {
  const hostKey = await loadHostKey(config);
  const server = new Server({ hostKeys: [hostKey], ident: "SSH-2.0-FlutterSFTP" }, (client) => {
    let auth: SftpAuth | null = null;
    /** Cleanup for each SFTP session opened on this connection. */
    const disposers: (() => void)[] = [];

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
        .catch((error: unknown) => {
          const rejected = error instanceof SftpAuthError && error.rejected;
          const reason = error instanceof Error ? error.message : String(error);
          if (rejected) {
            // Wrong password, no access, maintenance: normal, keep it quiet.
            logSftp("info", "sftp login rejected", { reason });
          } else {
            // Nobody can log in while the panel is unreachable from this node.
            logSftp("error", "sftp login failed: panel unreachable", { reason });
            reportDaemonError(config, {
              kind: "sftp",
              op: "AUTH",
              code: "PANEL_UNREACHABLE",
              name: "SftpAuthError",
              message: "SFTP login could not be checked: the panel did not answer",
            });
          }
          ctx.reject();
        });
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
          disposers.push(bindSftp(acceptSftp() as SftpStream, config, granted));
        });
        session.on("pty", (_accept, deny) => deny());
        session.on("shell", (_accept, deny) => deny());
        session.on("exec", (_accept, deny) => deny());
      });
    });
    client.on("close", () => {
      for (const dispose of disposers.splice(0)) dispose();
    });
    // Resets and timeouts from clients are routine; the close handler cleans up.
    client.on("error", () => undefined);
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(config.sftpPort, config.listenHost, () => {
      server.removeListener("error", reject);
      logSftp("info", "sftp listening", { port: config.sftpPort });
      resolveListen();
    });
  });
  return server;
}
