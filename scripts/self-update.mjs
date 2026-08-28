#!/usr/bin/env node
import { spawn } from "node:child_process";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.env.FLUTTER_UPDATE_ROOT || join(dirname(fileURLToPath(import.meta.url)), ".."));
const statusPath = join(root, ".flutter-update.json");
const revisionPath = join(root, ".flutter-revision");
const staging = join(root, ".update-work");
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
  const httpsRemote = `https://github.com/${repo}.git`;
  const attempts = [];
  if (hasGitRepo()) attempts.push(["ls-remote", "origin", ref]);
  attempts.push(["ls-remote", httpsRemote, ref]);
  for (const args of attempts) {
    try {
      const out = await new Promise((resolveRun, reject) => {
        const child = spawn("git", args, { cwd: root, windowsHide: true, shell: process.platform === "win32" });
        let text = "";
        child.stdout?.on("data", (chunk) => {
          text += String(chunk);
        });
        child.stderr?.on("data", (chunk) => {
          text += String(chunk);
        });
        child.on("error", reject);
        child.on("exit", (code) => {
          if (code === 0) resolveRun(text);
          else reject(new Error(text.trim() || `git exited ${code}`));
        });
      });
      const sha = String(out)
        .split("\n")
        .map((line) => line.trim().split(/\s+/)[0] ?? "")
        .find((value) => /^[0-9a-f]{40}$/i.test(value));
      if (sha) return sha;
    } catch {
      /* try the next remote */
    }
  }
  throw new Error("Could not read the GitHub ref over git");
}

function preserveLive(rel) {
  if (!rel || rel === ".") return false;
  if (rel === ".env" || rel === "apps/web/.env.local") return true;
  if (rel === ".flutter-update.json" || rel === ".flutter-revision") return true;
  if (rel === ".update-work" || rel.startsWith(".update-work/")) return true;
  if (rel.startsWith("apps/daemon/data")) return true;
  return false;
}

async function copyIfExists(from, to) {
  if (!existsSync(from)) return;
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

async function copyDirReplace(src, dest) {
  if (!existsSync(src)) return;
  await rm(dest, { recursive: true, force: true });
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true, force: true });
}

async function seedStagingEnv() {
  await copyIfExists(join(root, ".env"), join(staging, ".env"));
  await copyIfExists(join(root, "apps/web/.env.local"), join(staging, "apps/web/.env.local"));
}

async function prepareStaging() {
  log("Preparing a staging copy. The live panel stays on the current version until this build succeeds.");
  await rm(staging, { recursive: true, force: true });
  await run("git", [
    "clone",
    "--depth",
    "1",
    "--branch",
    ref,
    `https://github.com/${repo}.git`,
    staging,
  ]);
  await seedStagingEnv();
}

async function buildStaging() {
  log("Installing packages in staging");
  await run("npm", ["ci", "--include=dev"], staging);
  log("Applying database schema");
  await run("npm", ["run", "db:push"], staging);
  log("Building panel in staging");
  await run("npm", ["run", "build", "-w", "@flutter-software/web"], staging);
}

async function promoteStaging(sha) {
  log("Staging build succeeded. Switching the live install over.");
  if (hasGitRepo()) {
    try {
      await run("git", ["remote", "get-url", "origin"]);
    } catch {
      await run("git", ["remote", "add", "origin", `https://github.com/${repo}.git`]);
    }
    await run("git", ["fetch", "--tags", "origin", ref]);
    log("Syncing compiled assets");
    await copyDirReplace(join(staging, "node_modules"), join(root, "node_modules"));
    await copyDirReplace(join(staging, "apps/web/.next"), join(root, "apps/web/.next"));
    await run("git", ["reset", "--hard", sha || "FETCH_HEAD"]);
    await run("git", ["submodule", "update", "--init", "--recursive"]).catch(() => undefined);
    await run("node", ["scripts/link-shared.mjs"]);
    return;
  }
  await cp(staging, root, {
    recursive: true,
    force: true,
    filter: (from) => !preserveLive(relative(staging, from).split(sep).join("/")),
  });
  await run("node", ["scripts/link-shared.mjs"]);
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

async function cleanupStaging() {
  await rm(staging, { recursive: true, force: true }).catch(() => undefined);
}

async function main() {
  await mkdir(root, { recursive: true });
  log(`Flutter updater`);
  log(`Install: ${root}`);
  log(`Source: github.com/${repo} (${ref})`);

  if (!(await gitAvailable())) throw new Error("git is required to update the panel");

  const sha = await latestSha();
  await prepareStaging();
  await buildStaging();
  await promoteStaging(sha);
  promoted = true;
  await cleanupStaging();

  if (sha) await writeFile(revisionPath, `${sha}\n`, "utf8");

  log("Update is in place.");
  await restartPanel();
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  await writeStatus({ state: "ok", finishedAt: now(), error: null, sha });
}

let promoted = false;

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  log(`Update failed: ${message}`);
  if (promoted) {
    log("The live install may have been partially switched. Review the log before restarting services.");
  } else {
    log("Live panel files were not replaced. The current site is still the last working install.");
  }
  await cleanupStaging();
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  await writeStatus({ state: "failed", finishedAt: now(), error: message });
  process.exit(1);
});
