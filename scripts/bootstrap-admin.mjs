import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import mongoose from "mongoose";
import { hash } from "@node-rs/argon2";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(root, ".env") });

const HASH_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };
const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

function fail(message) {
  console.error(`[bootstrap-admin] ${message}`);
  process.exit(1);
}

function usernameFrom(email, fallback = "Administrator") {
  const local = String(email || "")
    .split("@")[0]
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .slice(0, 32);
  if (USERNAME_RE.test(local)) return local;
  return fallback;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail("DATABASE_URL is missing from .env");

  const email = String(process.env.FLUTTER_ADMIN_EMAIL || "")
    .trim()
    .toLowerCase();
  const password = String(process.env.FLUTTER_ADMIN_PASSWORD || "");
  const username = String(process.env.FLUTTER_ADMIN_USERNAME || usernameFrom(email)).trim();

  if (!email) fail("FLUTTER_ADMIN_EMAIL is required");
  if (password.length < 10) fail("FLUTTER_ADMIN_PASSWORD must be at least 10 characters");
  if (!USERNAME_RE.test(username)) fail("FLUTTER_ADMIN_USERNAME is invalid");

  await mongoose.connect(databaseUrl);
  const db = mongoose.connection.db;
  if (!db) fail("MongoDB is not connected");

  const users = db.collection("users");
  const existingCount = await users.countDocuments();
  if (existingCount > 0) {
    const existing = await users.findOne({ $or: [{ email }, { username }] }, { projection: { email: 1, username: 1 } });
    console.log(
      JSON.stringify({
        created: false,
        reason: "exists",
        email: existing?.email || email,
        username: existing?.username || username,
      }),
    );
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  await users.insertOne({
    username,
    email,
    passwordHash: await hash(password, HASH_OPTIONS),
    role: "admin",
    totpSecret: null,
    totpEnabled: false,
    emailVerified: true,
    emailVerifyHash: null,
    emailVerifyExpiresAt: null,
    oidcIssuer: null,
    oidcSub: null,
    createdAt: now,
    updatedAt: now,
  });

  console.log(JSON.stringify({ created: true, email, username }));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("[bootstrap-admin] failed:", error instanceof Error ? error.message : error);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
