import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import mongoose from "mongoose";
import { hash } from "@node-rs/argon2";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(root, ".env") });

const configPath = resolve(root, "apps/daemon/data/config.json");
const HASH_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

function token() {
  return `flt_${randomBytes(24).toString("base64url")}`;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const requestSecret = process.env.DAEMON_REQUEST_SECRET;
  const panelUrl = (process.env.API_INTERNAL_URL || "http://127.0.0.1:4000").replace(/\/+$/, "");
  const listenPort = Number(process.env.DAEMON_PORT || 8080);

  if (!databaseUrl) throw new Error("DATABASE_URL is missing from .env");
  if (!requestSecret) throw new Error("DAEMON_REQUEST_SECRET is missing from .env");

  await mongoose.connect(databaseUrl);
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB is not connected");

  const locations = db.collection("locations");
  const nodes = db.collection("nodes");
  const allocations = db.collection("allocations");

  let location = await locations.findOne({});
  if (!location) {
    const inserted = await locations.insertOne({
      shortCode: "local",
      description: "Local development",
      createdAt: new Date(),
    });
    location = await locations.findOne({ _id: inserted.insertedId });
  }

  let node = (await nodes.findOne({ name: "Local" })) ?? (await nodes.findOne({}));
  if (!node) {
    const daemonToken = token();
    const inserted = await nodes.insertOne({
      locationId: location._id,
      name: "Local",
      description: "Started by npm start",
      fqdn: "127.0.0.1",
      public: true,
      scheme: "http",
      behindProxy: false,
      daemonBase: "/var/lib/flutter/volumes",
      memoryMb: 8192,
      diskMb: 32768,
      memoryOverallocate: 0,
      diskOverallocate: 0,
      daemonPort: listenPort,
      sftpPort: 2022,
      tokenHash: await hash(daemonToken, HASH_OPTIONS),
      tokenPrefix: daemonToken.slice(0, 12),
      daemonToken,
      daemonListenUrl: `http://127.0.0.1:${listenPort}`,
      lastHeartbeatAt: null,
      createdAt: new Date(),
    });
    node = await nodes.findOne({ _id: inserted.insertedId });
  } else if (!node.daemonToken) {
    const daemonToken = token();
    await nodes.updateOne(
      { _id: node._id },
      {
        $set: {
          daemonToken,
          tokenPrefix: daemonToken.slice(0, 12),
          tokenHash: await hash(daemonToken, HASH_OPTIONS),
        },
      },
    );
    node.daemonToken = daemonToken;
  }

  const existingAlloc = await allocations.findOne({ nodeId: node._id });
  if (!existingAlloc) {
    await allocations.insertOne({
      nodeId: node._id,
      ip: "0.0.0.0",
      alias: "",
      port: 25565,
      notes: "",
      serverId: null,
      createdAt: new Date(),
    });
  }

  await mkdir(dirname(configPath), { recursive: true });
  const file = {
    panelUrl,
    nodeId: String(node._id),
    token: node.daemonToken,
    requestSecret,
    listenHost: "0.0.0.0",
    listenPort,
    listenUrl: `http://127.0.0.1:${listenPort}`,
    dataDir: "./data",
  };
  await writeFile(configPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  console.log(`[daemon] wrote ${configPath} for node ${file.nodeId}`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("[daemon] config failed:", error instanceof Error ? error.message : error);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
