import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skipBuild = process.argv.includes("--skip-build");
const forceBuild = process.argv.includes("--build");
const buildId = resolve(root, "apps/web/.next/BUILD_ID");

const children = [];
let shuttingDown = false;

function run(label, command, args) {
  return new Promise((resolveRun, reject) => {
    console.log(`[${label}] ${command} ${args.join(" ")}`);
    const child = spawn(command, args, {
      cwd: root,
      shell: true,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${label} exited ${code ?? "null"}`));
    });
  });
}

function service(label, args, { restart = false } = {}) {
  const boot = () => {
    if (shuttingDown) return;
    const child = spawn("npm", args, {
      cwd: root,
      shell: true,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "production" },
    });
    children.push(child);
    child.on("exit", (code) => {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      if (shuttingDown) return;
      if (restart) {
        console.warn(`[${label}] exited ${code ?? 0}, restarting…`);
        setTimeout(boot, 1000);
        return;
      }
      if (code && code !== 0) {
        console.error(`[${label}] exited ${code}`);
        shutdown(code);
      }
    });
  };
  boot();
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.pid) continue;
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", shell: true });
    } else {
      child.kill("SIGTERM");
    }
  }
  process.exit(code);
}

async function waitForApi(url, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      /* still booting */
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 400));
  }
  return false;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  try {
    await run("compose", "docker", ["compose", "up", "-d"]);
  } catch {
    console.warn("[compose] Docker Compose is not running — start Mongo/Redis yourself if the API fails.");
  }

  await run("prisma", "npm", ["run", "prisma:generate", "-w", "@flutter-software/api"]);

  const hasBuild = existsSync(buildId);
  if (forceBuild || (!skipBuild && !hasBuild)) {
    console.log("[web] Building production panel (one-time compile so pages are not built on request)…");
    await run("web", "npm", ["run", "build", "-w", "@flutter-software/web"]);
  } else if (skipBuild && !hasBuild) {
    throw new Error("No production build found. Run npm start without --skip-build.");
  } else {
    console.log("[web] Using existing production build. Pass --build to rebuild.");
  }

  try {
    await run("daemon", "node", ["scripts/ensure-daemon.mjs"]);
  } catch (error) {
    console.warn("[daemon] could not auto-configure:", error instanceof Error ? error.message : error);
  }

  console.log("");
  console.log("Flutter production");
  console.log("  Panel   http://localhost:3010");
  console.log("  API     http://127.0.0.1:4000");
  console.log("  Daemon  http://127.0.0.1:8080");
  console.log("");

  service("api", ["run", "start", "-w", "@flutter-software/api"]);
  service("web", ["run", "start", "-w", "@flutter-software/web"]);

  const apiReady = await waitForApi("http://127.0.0.1:4000/api/v1/health");
  if (!apiReady) console.warn("[api] health check timed out — starting daemon anyway");

  service("daemon", ["run", "start", "-w", "@flutter-software/daemon"], { restart: true });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
});
