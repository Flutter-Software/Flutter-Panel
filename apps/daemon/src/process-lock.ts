import { execFileSync } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

function pidFile(dataDir: string) {
  return join(dataDir, "daemon.pid");
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopPid(pid: number) {
  if (pid <= 0 || pid === process.pid || !isAlive(pid)) return false;
  try {
    process.kill(pid);
    return true;
  } catch {
    return false;
  }
}

function commandLineOf(pid: number) {
  try {
    if (process.platform === "win32") {
      const out = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
        ],
        { encoding: "utf8", timeout: 4000, windowsHide: true },
      );
      return out.trim();
    }
    return execFileSync("ps", ["-p", String(pid), "-o", "args="], {
      encoding: "utf8",
      timeout: 4000,
    }).trim();
  } catch {
    return "";
  }
}

function looksLikeDaemon(command: string) {
  const cmd = command.replace(/\\/g, "/").toLowerCase();
  return cmd.includes("src/index.ts") && (cmd.includes("tsx") || cmd.includes("daemon"));
}

function processName(pid: number) {
  try {
    if (process.platform === "win32") {
      return execFileSync(
        "powershell.exe",
        ["-NoProfile", "-Command", `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName`],
        { encoding: "utf8", timeout: 4000, windowsHide: true },
      ).trim();
    }
    return execFileSync("ps", ["-p", String(pid), "-o", "comm="], {
      encoding: "utf8",
      timeout: 4000,
    }).trim();
  } catch {
    return "";
  }
}

function pidsOnPort(port: number) {
  const pids = new Set<number>();
  try {
    if (process.platform === "win32") {
      const out = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`,
        ],
        { encoding: "utf8", timeout: 5000, windowsHide: true },
      );
      for (const piece of out.split(/\s+/)) {
        const pid = Number(piece);
        if (pid > 0 && pid !== process.pid) pids.add(pid);
      }
    } else {
      const out = execFileSync("sh", ["-c", `lsof -t -iTCP:${port} -sTCP:LISTEN 2>/dev/null || true`], {
        encoding: "utf8",
        timeout: 4000,
      });
      for (const piece of out.split(/\s+/)) {
        const pid = Number(piece);
        if (pid > 0 && pid !== process.pid) pids.add(pid);
      }
    }
  } catch {
    /* ignore */
  }
  return [...pids];
}

function shouldStop(pid: number) {
  const cmd = commandLineOf(pid);
  if (looksLikeDaemon(cmd)) return true;
  return processName(pid).toLowerCase() === "node";
}

export async function reclaimPreviousDaemon(dataDir: string, ports: number[]) {
  const path = pidFile(dataDir);
  try {
    const old = Number((await readFile(path, "utf8")).trim());
    if (stopPid(old)) console.warn(`[daemon] stopped previous process ${old}`);
  } catch {
    /* no pid file */
  }
  for (const port of ports) {
    for (const pid of pidsOnPort(port)) {
      if (!shouldStop(pid)) continue;
      if (stopPid(pid)) console.warn(`[daemon] stopped leftover process ${pid} on port ${port}`);
    }
  }
}

export async function writeDaemonPid(dataDir: string) {
  await writeFile(pidFile(dataDir), String(process.pid));
}

export async function clearDaemonPid(dataDir: string) {
  const path = pidFile(dataDir);
  try {
    const current = Number((await readFile(path, "utf8")).trim());
    if (current !== process.pid) return;
    await unlink(path);
  } catch {
    /* ignore */
  }
}
