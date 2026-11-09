"use client";

import { useEffect } from "react";
import { bindClientErrorHandlers } from "@/lib/telemetry";

export function TelemetryErrors() {
  useEffect(() => bindClientErrorHandlers(), []);
  return null;
}
