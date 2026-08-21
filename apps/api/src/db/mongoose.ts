import mongoose from "mongoose";
import { env } from "../env";
import { log } from "../log";

export async function connectMongo() {
  if (mongoose.connection.readyState === 1) return;
  mongoose.set("strictQuery", true);
  await mongoose.connect(env().DATABASE_URL);
  log("info", "mongoose connected");
}

export async function pingMongo() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("mongoose is not connected");
  await db.admin().command({ ping: 1 });
}
