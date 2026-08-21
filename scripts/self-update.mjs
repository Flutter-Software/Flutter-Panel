#!/usr/bin/env node
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(process.env.FLUTTER_UPDATE_ROOT || join(dirname(fileURLToPath(import.meta.url)), ".."));
const statusPath = join(root, ".flutter-update.json");
const revisionPath = join(root, ".flutter-revision");
const repo = (process.env.FLUTTER_UPDATE_REPO || "Flutter-Software/Flutter-Panel").trim();
const ref = (process.env.FLUTTER_UPDATE_REF || "main").trim();

if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
  console.error("Invalid FLUTTER_UPDATE_REPO");
  process.exit(1);
}
if (!/^[A-Za-z0-9._/-]+$/.test(ref)) {
  console.error("Invalid FLUTTER_UPDATE_REF");
  process.exit(1);
}

const logLines = [];

function now() {
  return new Date().toISOString();
}

let statusTimer = null;

async function writeStatus(partial) {
  let current = {};
  if (existsSync(statusPath)) {
    try {
      current = JSON.parse(await readFile(statusPath, "utf8"));
    } catch {
      current = {};
    }
  }
  const next = {
    ...current,
    state: "running",
    startedAt: current.startedAt || now(),
    ...partial,
    log: logLines.slice(-200),
    updatedAt: now(),
  };
  await writeFile(statusPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function log(message) {
  const line = String(message).replace(/\s+$/g, "");
  if (!line) return;
  logLines.push(line);
  console.log(line);
  if (statusTimer) return;
  statusTimer = setTimeout(() => {
    statusTimer = null;
    void writeStatus({ state: "running" });
  }, 250);
}

function run(command, args, cwd = root) {
  return new Promise((resolveRun, reject) => {
    log(`$ ${command} ${args.join(" ")}`);
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: process.platform === "win32",
      windowsHide: true,
    });
    const onChunk = (chunk) => {
      const text = String(chunk);
      for (const part of text.split(/\r?\n/)) log(part);
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited ${code ?? "null"}`));
    });
  });
}

function gitAvailable() {
  return new Promise((resolveGit) => {
    const child = spawn("git", ["--version"], { windowsHide: true, shell: process.platform === "win32" });
    child.on("error", () => resolveGit(false));
    child.on("exit", (code) => resolveGit(code === 0));
  });
}

function hasGitRepo() {
  return existsSync(join(root, ".git"));
}

async function latestSha() {
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Flutter-Panel",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  const json = (await response.json());
  return String(json.sha ?? "");
}

function skipCopy(from, srcRoot) {
  const rel = relative(srcRoot, from).split(sep).join("/");
  if (!rel || rel === ".") return true;
  if (rel === ".env" || rel === "apps/web/.env.local" || rel === ".flutter-update.json" || rel === ".flutter-revision") return false;
  if (rel === "node_modules" || rel.startsWith("node_modules/")) return false;
  if (rel.includes("/node_modules/")) return false;
  if (rel === ".next" || rel.startsWith(".next/") || rel.includes("/.next/")) return false;
  if (rel.startsWith("apps/web/.next")) return false;
  if (rel.startsWith("apps/daemon/data")) return false;
  return true;
}

async function copyFrom(src) {
  log(`Copying files from ${src}`);
  await cp(src, root, {
    recursive: true,
    force: true,
    filter: (from) => skipCopy(from, src),
  });
}

async function applyGit() {
  log("Updating via git");
  try {
    await run("git", ["remote", "get-url", "origin"]);
  } catch {
    await run("git", ["remote", "add", "origin", `https://github.com/${repo}.git`]);
  }
  await run("git", ["fetch", "--tags", "origin", ref]);
  await run("git", ["reset", "--hard", "FETCH_HEAD"]);
  await run("git", ["submodule", "update", "--init", "--recursive"]).catch(() => undefined);
}

async function applyClone() {
  const tmp = join(tmpdir(), `flutter-update-${process.pid}`);
  await rm(tmp, { recursive: true, force: true });
  log("Cloning latest source");
  await run("git", ["clone", "--depth", "1", "--branch", ref, `https://github.com/${repo}.git`, tmp]);
  await copyFrom(tmp);
  await rm(tmp, { recursive: true, force: true });
}

async function restartPanel() {
  const helper = "/usr/local/sbin/flutter-restart";
  if (process.platform === "win32") {
    log("Restart the panel processes (npm run dev / npm start) to load the new build.");
    return;
  }
  try {
    if (existsSync(helper)) {
      await run("sudo", ["-n", helper]);
      log("Restarted panel services.");
      return;
    }
    await run("sudo", ["-n", "systemctl", "restart", "flutter-api", "flutter-web", "flutter-daemon"]);
    log("Restarted panel services.");
  } catch {
    log("Could not restart systemd automatically. Restart flutter-api, flutter-web, and flutter-daemon yourself.");
  }
}

async function main() {
  await mkdir(root, { recursive: true });
  log(`Flutter updater`);
  log(`Install: ${root}`);
  log(`Source: github.com/${repo} (${ref})`);

  const sha = await latestSha();
  if (hasGitRepo()) await applyGit();
  else if (await gitAvailable()) await applyClone();
  else throw new Error("git is required to update the panel");

  if (sha) await writeFile(revisionPath, `${sha}\n`, "utf8");

  log("Installing packages");
  await run("npm", ["ci"]);
  log("Applying database schema");
  await run("npm", ["run", "db:push"]);
  log("Building panel");
  await run("npm", ["run", "build", "-w", "@flutter-software/web"]);

  log("Update files are in place.");
  await restartPanel();
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  await writeStatus({ state: "ok", finishedAt: now(), error: null, sha });
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  log(`Update failed: ${message}`);
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  await writeStatus({ state: "failed", finishedAt: now(), error: message });
  process.exit(1);
});
