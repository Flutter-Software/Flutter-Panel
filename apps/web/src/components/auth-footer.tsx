import { PANEL_VERSION } from "@flutter-software/shared";
import { TelemetryNotice } from "@/components/telemetry-notice";
import { cn } from "@/lib/cn";

/**
 * Footer for the signed-out pages (login, register, verify, invite): the panel
 * version, followed by the telemetry icon when telemetry is on. Sits in normal
 * flow; `AuthShell` places it at the bottom of the side rail (or under the form
 * on narrow screens).
 */
export function AuthFooter({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 text-[12px] text-muted-foreground", className)}>
      <p data-numeric>Version {PANEL_VERSION}</p>
      <TelemetryNotice />
    </div>
  );
}
