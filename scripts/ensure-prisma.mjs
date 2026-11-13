/**
 * Makes sure the Prisma client in node_modules is generated and matches
 * apps/api/prisma/schema.prisma, regenerating it when it is not.
 *
 * Why: `npm ci` installs @prisma/client with a placeholder that throws
 * "@prisma/client did not initialize yet" the moment the API imports it.
 * The client only becomes real after `prisma generate`. If anything replaces
 * node_modules without generating (an update that skipped the schema step,
 * a manual `npm ci`, a restored backup), the API crash-loops and nginx
 * answers every /api request with 502.
 *
 * Runs as the API's `prestart` hook, so systemd restarts heal themselves.
 * Cheap when the client is already current: two small file reads, no spawn.
 *
 * Usage:
 *   node scripts/ensure-prisma.mjs           # generate only if missing/stale
 *   node scripts/ensure-prisma.mjs --check   # exit 1 if missing/stale, never generate
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const sourceSchema = join(root, "apps", "api", "prisma", "schema.prisma");
// `prisma generate` writes the client here (hoisted by npm workspaces) and
// copies the schema next to it, which lets us detect a stale client.
const clientDir = join(root, "node_modules", ".prisma", "client");
const generatedSchema = join(clientDir, "schema.prisma");

/**
 * Reads a schema and reduces it to its meaning: `prisma generate` stores a
 * reformatted copy (aligned columns, comments removed), so compare with
 * comments stripped and all whitespace collapsed.
 */
function read(path) {
  try {
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.replace(/\/\/.*$/, "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  } catch {
    return null;
  }
}

/**
 * Returns why the client needs generating, or null when it is current.
 * `fatal` means the API cannot start at all (placeholder client); a stale
 * client still runs, so failing to refresh it only warns.
 */
function problem() {
  if (!existsSync(join(clientDir, "default.js"))) return { reason: "Prisma client is not installed", fatal: true };
  const generated = read(generatedSchema);
  if (generated === null) return { reason: "Prisma client has not been generated", fatal: true };
  const source = read(sourceSchema);
  if (source !== null && source !== generated) {
    return { reason: "Prisma client is out of date with schema.prisma", fatal: false };
  }
  return null;
}

const found = problem();
if (!found) process.exit(0);

if (checkOnly) {
  console.error(`[ensure-prisma] ${found.reason}.`);
  process.exit(1);
}

console.log(`[ensure-prisma] ${found.reason}; running prisma generate…`);
// One command string: Node 22 deprecates args + shell:true (DEP0190).
const result = spawnSync("npm run prisma:generate -w @flutter-software/api", {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: process.env,
});
const after = result.status === 0 ? problem() : found;

if (!after) {
  console.log("[ensure-prisma] Prisma client generated.");
  process.exit(0);
}
if (after.fatal) {
  console.error(`[ensure-prisma] ${after.reason}. The API cannot start until \`npm run prisma:generate -w @flutter-software/api\` succeeds.`);
  process.exit(1);
}
// Stale but usable: start anyway rather than take the panel down.
console.warn(`[ensure-prisma] ${after.reason}; starting with the existing client.`);
