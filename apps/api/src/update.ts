import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FlutterError, PANEL_VERSION } from "@flutter-software/shared";

const DEFAULT_REPO = "Flutter-Software/Flutter-Panel";
const DEFAULT_REF = "main";
const STALE_MS = 30 * 60 * 1000;
const REMOTE_CACHE_MS = 10 * 60 * 1000;

export type UpdateJob = {
  state: "idle" | "running" | "ok" | "failed";
  log: string[];
  startedAt?: string;
  finishedAt?: string;
  error?: string | null;
  sha?: string;
  version?: string;
};

type RemoteCommit = {
  sha: string;
  shortSha: string;
  message: string;
  date: string;
  url: string;
};

let remoteCache: { at: number; value: RemoteCommit } | null = null;

export type UpdateJob = {
  state: "idle" | "running" | "ok" | "failed";
  log: string[];
  startedAt?: string;
  finishedAt?: string;
  error?: string | null;
  sha?: string;
  version?: string;
};

function repoRoot() {
  if (process.env.FLUTTER_UPDATE_ROOT) return resolve(process.env.FLUTTER_UPDATE_ROOT);
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

function githubRepo() {
  const raw = (process.env.FLUTTER_UPDATE_REPO || DEFAULT_REPO).trim();
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw) ? raw : DEFAULT_REPO;
}

function githubRef() {
  const raw = (process.env.FLUTTER_UPDATE_REF || DEFAULT_REF).trim();
  return /^[A-Za-z0-9._/-]+$/.test(raw) ? raw : DEFAULT_REF;
}

function statusPath() {
  return join(repoRoot(), ".flutter-update.json");
}

function revisionPath() {
  return join(repoRoot(), ".flutter-revision");
}

function scriptPath() {
  return join(repoRoot(), "scripts/self-update.mjs");
}

async function readJson(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export async function readUpdateJob(): Promise<UpdateJob> {
  const raw = await readJson(statusPath());
  if (!raw || typeof raw !== "object") {
    return { state: "idle", log: [] };
  }
  const state =
    raw.state === "running" || raw.state === "ok" || raw.state === "failed" ? raw.state : "idle";
  return {
    state,
    log: Array.isArray(raw.log) ? raw.log.map(String) : [],
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : undefined,
    finishedAt: typeof raw.finishedAt === "string" ? raw.finishedAt : undefined,
    error: typeof raw.error === "string" ? raw.error : null,
    sha: typeof raw.sha === "string" ? raw.sha : undefined,
    version: typeof raw.version === "string" ? raw.version : undefined,
  };
}

function runGit(args: string[]) {
  return new Promise<string>((resolveRun, reject) => {
    const child = spawn("git", args, {
      cwd: repoRoot(),
      env: process.env,
      windowsHide: true,
    });
    let out = "";
    child.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolveRun(out.trim());
      else reject(new Error(out.trim() || `git exited ${code}`));
    });
  });
}

async function localSha() {
  if (existsSync(join(repoRoot(), ".git"))) {
    try {
      return await runGit(["rev-parse", "HEAD"]);
    } catch {
      /* fall through */
    }
  }
  try {
    const raw = (await readFile(revisionPath(), "utf8")).trim();
    return raw || "";
  } catch {
    return "";
  }
}

function parseLsRemote(output: string) {
  for (const line of output.split("\n")) {
    const sha = line.trim().split(/\s+/)[0] ?? "";
    if (/^[0-9a-f]{40}$/i.test(sha)) return sha;
  }
  return "";
}

function githubToken() {
  return (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
}

async function remoteShaViaGit() {
  const repo = githubRepo();
  const ref = githubRef();
  const httpsRemote = `https://github.com/${repo}.git`;
  const attempts: string[][] = [];
  if (existsSync(join(repoRoot(), ".git"))) attempts.push(["ls-remote", "origin", ref]);
  attempts.push(["ls-remote", httpsRemote, ref]);
  for (const args of attempts) {
    try {
      const sha = parseLsRemote(await runGit(args));
      if (sha) return sha;
    } catch {
      /* try the next remote */
    }
  }
  throw new Error("Could not read the GitHub ref over git");
}

async function remoteCommitViaApi() {
  const repo = githubRepo();
  const ref = githubRef();
  const token = githubToken();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Flutter-Panel",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 403) {
    throw new Error(
      token
        ? "GitHub returned 403. Check GITHUB_TOKEN permissions for this repo."
        : "GitHub rate-limited this panel (HTTP 403). Wait a few minutes or set GITHUB_TOKEN.",
    );
  }
  if (!response.ok) throw new Error(`Could not reach GitHub (${response.status})`);
  const json = (await response.json()) as {
    sha?: string;
    html_url?: string;
    commit?: { message?: string; committer?: { date?: string } };
  };
  const sha = json.sha || "";
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message: (json.commit?.message || "").split("\n")[0]?.trim() || "",
    date: json.commit?.committer?.date || "",
    url: json.html_url || `https://github.com/${repo}`,
  } satisfies RemoteCommit;
}

async function remoteCommit() {
  if (remoteCache && Date.now() - remoteCache.at < REMOTE_CACHE_MS) return remoteCache.value;
  const repo = githubRepo();
  const url = `https://github.com/${repo}`;
  let value: RemoteCommit | null = null;
  try {
    const sha = await remoteShaViaGit();
    value = { sha, shortSha: sha.slice(0, 7), message: `Latest ${githubRef()}`, date: "", url };
  } catch {
    value = await remoteCommitViaApi();
  }
  remoteCache = { at: Date.now(), value };
  return value;
}

export async function getUpdateStatus() {
  const root = repoRoot();
  const writable = await access(root, fsConstants.W_OK)
    .then(() => true)
    .catch(() => false);
  const production = process.env.NODE_ENV === "production" || process.env.FLUTTER_ALLOW_DEV_UPDATE === "1";
  const currentSha = await localSha();
  const job = await readUpdateJob();
  let latest = {
    sha: "",
    shortSha: "",
    message: "",
    date: "",
    url: `https://github.com/${githubRepo()}`,
  };
  let checkError: string | null = null;
  try {
    latest = await remoteCommit();
  } catch (error) {
    checkError = error instanceof Error ? error.message : "Could not check for updates";
  }
  const canUpdate = writable && production && existsSync(scriptPath());
  const blockedReason = !production
    ? "In-place updates run only in production installs (NODE_ENV=production)."
    : !writable
      ? "The panel cannot write to its install directory."
      : !existsSync(scriptPath())
        ? "scripts/self-update.mjs is missing."
        : null;
  const updateAvailable = Boolean(latest.sha && currentSha && latest.sha !== currentSha) || Boolean(latest.sha && !currentSha);
  return {
    version: PANEL_VERSION,
    repo: githubRepo(),
    ref: githubRef(),
    currentSha,
    currentShortSha: currentSha.slice(0, 7),
    latest,
    updateAvailable,
    canUpdate,
    blockedReason,
    method: existsSync(join(root, ".git")) ? "git" : "clone",
    checkError,
    job,
  };
}

function runHelper(command: string, args: string[]) {
  return new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let err = "";
    child.stderr?.on("data", (chunk) => {
      err += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(err.trim() || `${command} exited ${code}`));
    });
  });
}

export async function startUpdate() {
  const status = await getUpdateStatus();
  if (!status.canUpdate) {
    throw FlutterError.unavailable(status.blockedReason || "This install cannot be updated in place.");
  }
  const job = await readUpdateJob();
  if (job.state === "running") {
    const started = job.startedAt ? Date.parse(job.startedAt) : 0;
    if (Date.now() - started < STALE_MS) {
      throw FlutterError.conflict("An update is already running");
    }
  }
  const startedAt = new Date().toISOString();
  await writeFile(
    statusPath(),
    `${JSON.stringify(
      {
        state: "running",
        log: ["Starting updater…"],
        startedAt,
        error: null,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const helper = "/usr/local/sbin/flutter-update";
  try {
    if (process.platform !== "win32" && existsSync(helper)) {
      await runHelper("sudo", ["-n", helper]);
    } else {
      const child = spawn(process.execPath, [scriptPath()], {
        cwd: repoRoot(),
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          FLUTTER_UPDATE_ROOT: repoRoot(),
          FLUTTER_UPDATE_REPO: githubRepo(),
          FLUTTER_UPDATE_REF: githubRef(),
        },
        windowsHide: true,
      });
      child.unref();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start updater";
    await writeFile(
      statusPath(),
      `${JSON.stringify({ state: "failed", log: [message], startedAt, finishedAt: new Date().toISOString(), error: message }, null, 2)}\n`,
      "utf8",
    );
    throw FlutterError.unavailable(message);
  }
  return { started: true, startedAt };
}
