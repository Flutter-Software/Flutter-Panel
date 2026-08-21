import { createClient } from "redis";
import { env } from "./env";

export const redis = createClient({ url: env().REDIS_URL });

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
