import { PANEL_VERSION } from "@flutter-software/shared";
import { pingMongo } from "./db/mongoose";
import { pingPrisma } from "./db/prisma";
import { pingRedis } from "./redis";

export type HealthCheck = { ok: boolean; latencyMs?: number; error?: string };
export type PanelHealth = {
  ok: boolean;
  service: "api";
  version: string;
  requestId?: string;
  checks: Record<string, HealthCheck>;
};

async function timed(fn: () => Promise<unknown>): Promise<HealthCheck> {
  const started = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : "failed",
    };
  }
}

export async function panelHealth(requestId?: string): Promise<PanelHealth> {
  const checks: Record<string, HealthCheck> = {
    mongo: await timed(() => pingMongo()),
    prisma: await timed(() => pingPrisma()),
    redis: await timed(() => pingRedis()),
  };
  return {
    ok: checks.mongo?.ok === true && checks.prisma?.ok === true,
    service: "api",
    version: PANEL_VERSION,
    requestId,
    checks,
  };
}
