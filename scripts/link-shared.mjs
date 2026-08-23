import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "packages", "shared");
const apps = ["web", "api", "daemon"];

for (const app of apps) {
  const appDir = join(root, "apps", app);
  if (!existsSync(appDir)) continue;
  const dest = join(appDir, "node_modules", "@flutter-software", "shared");
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
  symlinkSync(target, dest, "junction");
}

console.log("Linked @flutter-software/shared into app node_modules");
