"use client";

import { useEffect, useState } from "react";
import { Tooltip } from "@mantine/core";
import { Activity } from "lucide-react";
import { api, type SetupResponse } from "@/lib/api";

// Shown before sign-in, so this is the disclosure people get about what leaves
// their panel. Keep it in step with what apps/api/src/telemetry.ts actually sends.
const DISCLOSURE =
  "Anonymous telemetry is on. This panel shares an install id, version, operating system, counts, " +
  "file-download outcomes, and error reports with the message and stack trace. Emails, passwords, " +
  "tokens, and database URLs are removed before sending.";

/**
 * Amber icon that appears only while anonymous telemetry is enabled. The full
 * disclosure opens on hover, keyboard focus, or tap, and is also the button's
 * accessible name so screen readers announce it without opening the tooltip.
 */
export function TelemetryNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    api<SetupResponse>("/api/v1/auth/setup")
      .then((result) => setShow(Boolean(result.data.telemetry?.anonymous)))
      .catch(() => setShow(false));
  }, []);

  if (!show) return null;

  return (
    <Tooltip
      label={DISCLOSURE}
      multiline
      // Stays inside the viewport on phones, where a fixed width would clip.
      w="min(20rem, calc(100vw - 2rem))"
      position="top"
      events={{ hover: true, focus: true, touch: true }}
    >
      <button
        type="button"
        aria-label={DISCLOSURE}
        className="inline-flex rounded-sm text-amber-500 outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
      >
        <Activity className="h-3.5 w-3.5" aria-hidden />
      </button>
    </Tooltip>
  );
}
