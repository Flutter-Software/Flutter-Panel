"use client";

/**
 * Settings → Telemetry.
 *
 * A single preference, so it saves the moment the switch flips (the
 * standard pattern for one-off toggles) instead of going through the
 * unsaved-changes bar. The switch is optimistic and rolls back on failure.
 */

import { useEffect, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { Switch } from "@mantine/core";
import { SettingsCard, SettingsToggleRow } from "./workspace";

export type TelemetryPublic = {
  enabled: boolean;
  envDisabled: boolean;
  installId: string | null;
  sending: boolean;
};

const COLLECTED = [
  "A random install ID, panel version, Node.js runtime, and OS/architecture",
  "Counts of servers, nodes, users, and eggs (never names)",
  "Whether mail, SSO, and Redis are enabled",
  "File download success or failure, with a short message when it fails",
  "API errors: message, stack trace, status, route template, and request ID",
  "Background failures such as install, power, schedules, and mail",
  "Browser crashes and unhandled promise rejections",
];

const NEVER_COLLECTED = ["Emails or usernames", "Passwords, tokens, or API keys", "Database URLs", "Server names or files"];

export function TelemetrySection({
  telemetry,
  pending,
  onSave,
}: {
  telemetry: TelemetryPublic | undefined;
  pending: boolean;
  onSave: (enabled: boolean) => Promise<boolean>;
}) {
  const [enabled, setEnabled] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (telemetry) setEnabled(telemetry.enabled);
  }, [telemetry]);

  const locked = Boolean(telemetry?.envDisabled);

  async function toggle(next: boolean) {
    setEnabled(next);
    const ok = await onSave(next);
    if (!ok) setEnabled(!next);
  }

  return (
    <div className="space-y-5">
      <SettingsCard
        footer={
          locked ? (
            <span>
              Turned off by <code className="font-mono text-xs text-foreground">TELEMETRY_DISABLED</code> on the
              panel host.
            </span>
          ) : (
            <span>Changes save automatically.</span>
          )
        }
      >
        <SettingsToggleRow
          title="Share anonymous telemetry"
          description="Helps fix crashes faster. Personal data and secrets are stripped before anything is sent."
          control={
            <Switch
              checked={locked ? false : enabled}
              disabled={locked || pending}
              onChange={(event) => void toggle(event.currentTarget.checked)}
              aria-label="Share anonymous telemetry"
            />
          }
        />
      </SettingsCard>

      <div className="grid gap-5 md:grid-cols-[1.6fr_1fr]">
        <SettingsCard title="What is shared">
          <ul className="space-y-2 text-sm">
            {COLLECTED.map((line) => (
              <li key={line} className="flex gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-status-running" />
                <span className="text-muted-foreground">{line}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Stack traces can include file paths on this machine.</p>
        </SettingsCard>
        <SettingsCard title="Never shared">
          <ul className="space-y-2 text-sm">
            {NEVER_COLLECTED.map((line) => (
              <li key={line} className="flex gap-2.5">
                <X className="mt-0.5 size-4 shrink-0 text-status-error" />
                <span className="text-muted-foreground">{line}</span>
              </li>
            ))}
          </ul>
        </SettingsCard>
      </div>

      {telemetry?.installId ? (
        <SettingsCard title="Install ID" description="Anonymous identifier for this panel. Not tied to your domain.">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs">
              {telemetry.installId}
            </code>
            <button
              type="button"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Copy install ID"
              onClick={() => {
                void navigator.clipboard.writeText(telemetry.installId ?? "").then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1400);
                });
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </button>
          </div>
        </SettingsCard>
      ) : null}
    </div>
  );
}
