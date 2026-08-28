import { createClient } from "redis";
import { env } from "./env";

// Sessions live in Mongo. Redis is installed with the panel and pinged from
// /health; nothing in the API uses it as a cache yet. Boot continues if it's down.
const redis = createClient({ url: env().REDIS_URL });

export async function connectRedis() {
  if (!redis.isOpen) {
    await redis.connect();
  }
}

export async function pingRedis() {
  if (!redis.isOpen) {
    await redis.connect();
  }
  return redis.ping();
}
