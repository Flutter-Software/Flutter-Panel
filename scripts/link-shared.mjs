import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "packages", "shared");
const dests = [
  join(root, "apps", "web", "node_modules", "@flutter-software", "shared"),
  join(root, "apps", "api", "node_modules", "@flutter-software", "shared"),
  join(root, "apps", "daemon", "node_modules", "@flutter-software", "shared"),
];

for (const dest of dests) {
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
  symlinkSync(target, dest, "junction");
}

console.log("Linked @flutter-software/shared into app node_modules");
