import { z } from "zod";

export const checkResultSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().optional(),
  error: z.string().optional(),
});

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.string(),
  version: z.string(),
  requestId: z.string(),
  checks: z.record(checkResultSchema),
});

export type CheckResult = z.infer<typeof checkResultSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
