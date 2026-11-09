import { PANEL_VERSION } from "@flutter-software/shared";
import { Tag } from "lucide-react";
import { TelemetryNotice } from "@/components/telemetry-notice";

/**
 * Pinned footer for the signed-out pages (login, register, verify, invite):
 * the panel version, followed by the telemetry icon when telemetry is on.
 * The parent page must be `relative` for the absolute positioning to anchor.
 */
export function AuthFooter() {
  return (
    <div className="absolute bottom-6 flex items-center gap-2 font-mono text-xs text-muted-foreground">
      <p className="flex items-center gap-1">
        <Tag className="h-3 w-3" aria-hidden />
        {/* The icon replaces the visible "v", so screen readers still need the label. */}
        <span className="sr-only">Version </span>
        {PANEL_VERSION}
      </p>
      <TelemetryNotice />
    </div>
  );
}
