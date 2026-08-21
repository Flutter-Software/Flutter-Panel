import { config } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

config({ path: resolve(process.cwd(), "../../.env") });
config();

function emptyToUndef(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  APP_URL: z.string().url(),
  API_INTERNAL_URL: z.string().url().default("http://127.0.0.1:4000"),
  API_WS_URL: z.string().optional(),
  SESSION_SECRET: z.string().min(32),
  DAEMON_REQUEST_SECRET: z.string().min(32),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  SMTP_HOST: z.preprocess(emptyToUndef, z.string().min(1).optional()),
  SMTP_PORT: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).max(65535).optional()),
  SMTP_USER: z.preprocess(emptyToUndef, z.string().min(1).optional()),
  SMTP_PASS: z.preprocess(emptyToUndef, z.string().optional()),
  SMTP_FROM: z.preprocess(emptyToUndef, z.string().min(1).optional()),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid API environment. Copy .env.example and run npm run setup.");
  }
  cached = parsed.data;
  return cached;
}

export function isProduction() {
  return env().NODE_ENV === "production";
}

export function consoleWsUrl() {
  const raw = (env().API_WS_URL || env().API_INTERNAL_URL).replace(/\/+$/, "");
  const base =
    raw.startsWith("ws://") || raw.startsWith("wss://") ? raw : raw.replace(/^http/, "ws");
  return `${base}/api/v1/ws/console`;
}
