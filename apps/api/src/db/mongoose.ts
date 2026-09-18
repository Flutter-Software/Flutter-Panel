import mongoose from "mongoose";
import { env } from "../env";
import { log } from "../log";

export async function connectMongo() {
  mongoose.set("strictQuery", true);
  // Don't queue queries for 10s when Mongo drops — fail the request so the
  // panel can show a 500 instead of hanging on a signed-in shell.
  mongoose.set("bufferCommands", false);
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(env().DATABASE_URL);
  log("info", "mongoose connected");
}

export function mongoConnected() {
  return mongoose.connection.readyState === 1;
}

export async function pingMongo() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("mongoose is not connected");
  await db.admin().command({ ping: 1 });
}
