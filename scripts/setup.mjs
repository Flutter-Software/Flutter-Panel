import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");

if (existsSync(envPath) && !process.argv.includes("--force")) {
  console.log(".env already exists. Pass --force to overwrite.");
  process.exit(0);
}

const secret = () => randomBytes(48).toString("base64url");

const contents = `NODE_ENV=development
APP_URL=http://localhost:3010
API_INTERNAL_URL=http://127.0.0.1:4000
PORT=4000
HOST=0.0.0.0
DATABASE_URL=mongodb://127.0.0.1:27017/flutter?replicaSet=rs0
REDIS_URL=redis://127.0.0.1:6379
SESSION_SECRET=${secret()}
DAEMON_REQUEST_SECRET=${secret()}
COOKIE_SECURE=false
DAEMON_PORT=8080
`;

writeFileSync(envPath, contents, "utf8");
writeFileSync(
  resolve(root, "apps/web/.env.local"),
  `API_INTERNAL_URL=http://127.0.0.1:4000
`,
  "utf8",
);
console.log("Wrote .env and apps/web/.env.local");
