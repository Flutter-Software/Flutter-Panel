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
    // z.enum optional + transform: missing stays undefined, "false" must not
    // become true. Empty string is stripped earlier.
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

export function isLoopbackHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function hostnameOf(origin: string) {
  try {
    const http = origin.replace(/^ws/i, "http");
    return new URL(http.includes("://") ? http : `http://${http}`).hostname;
  } catch {
    return "";
  }
}

function toWsConsoleUrl(origin: string) {
  const base = origin.replace(/\/+$/, "");
  const ws = base.startsWith("ws") ? base : base.replace(/^http/, "ws");
  return `${ws}/api/v1/ws/console`;
}

/** Browser-facing console URL. Never advertise 127.0.0.1 to a remote client. */
export function consoleWsUrl(requestOrigin?: string) {
  const app = env().APP_URL.replace(/\/+$/, "");
  const origin = requestOrigin?.replace(/\/+$/, "") || "";
  const originHost = origin ? hostnameOf(origin) : "";
  if (originHost && !isLoopbackHost(originHost)) return toWsConsoleUrl(origin);
  if (!isLoopbackHost(hostnameOf(app))) return toWsConsoleUrl(app);
  const fallback = (env().API_WS_URL || env().API_INTERNAL_URL).replace(/\/+$/, "");
  return toWsConsoleUrl(fallback);
}

export function requestOrigin(headers: { host?: string | null; proto?: string | null }) {
  const host = (headers.host || "").split(",")[0]?.trim();
  const proto = (headers.proto || "").split(",")[0]?.trim() || "http";
  if (!host) return undefined;
  return `${proto}://${host}`;
}
