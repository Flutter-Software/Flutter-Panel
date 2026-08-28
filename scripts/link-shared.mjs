import { lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "packages", "shared");
const dests = [
  join(root, "node_modules", "@flutter-software", "shared"),
  ...["web", "api", "daemon"].map((app) =>
    join(root, "apps", app, "node_modules", "@flutter-software", "shared"),
  ),
];

function present(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

for (const dest of dests) {
  mkdirSync(dirname(dest), { recursive: true });
  if (present(dest)) rmSync(dest, { recursive: true, force: true });
  const win = process.platform === "win32";
  symlinkSync(win ? target : relative(dirname(dest), target), dest, win ? "junction" : undefined);
}

console.log("Linked @flutter-software/shared into app and root node_modules");
