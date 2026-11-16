"use client";

/**
 * Settings → Telemetry.
 *
 * A single preference, so it saves the moment the switch flips (the
 * standard pattern for one-off toggles) instead of going through the
 * unsaved-changes bar. The switch is optimistic and rolls back on failure.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { Switch } from "@mantine/core";
import { CopyField, SettingsCard, SettingsRow, SettingsToggleRow } from "./workspace";

export type TelemetryPublic = {
  enabled: boolean;
  envDisabled: boolean;
  installId: string | null;
  sending: boolean;
};

const COLLECTED = [
  "Random install ID, panel version, Node.js runtime, OS and architecture",
  "Counts of servers, nodes, users and eggs (never names)",
  "Whether mail, SSO and Redis are enabled",
  "Download failures, API errors and background job failures",
  "Browser crashes and unhandled promise rejections",
];

const NEVER_COLLECTED = ["Emails or usernames", "Passwords, tokens or API keys", "Database URLs", "Server names or files"];

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

  function copyInstallId() {
    void navigator.clipboard.writeText(telemetry?.installId ?? "").then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  }

  return (
    <div className="space-y-5">
      <SettingsCard
        footer={
          locked ? (
            <span>
              Turned off by <code className="font-mono text-[12.5px] text-foreground">TELEMETRY_DISABLED</code> on the
              panel host.
            </span>
          ) : (
            <span>Changes save automatically.</span>
          )
        }
      >
        <SettingsToggleRow
          title="Share anonymous telemetry"
          description="Helps us fix crashes faster. Personal data and secrets are stripped before anything is sent."
          control={
            <Switch
              checked={locked ? false : enabled}
              disabled={locked || pending}
              onChange={(event) => void toggle(event.currentTarget.checked)}
              aria-label="Share anonymous telemetry"
            />
          }
        />
        {telemetry?.installId ? (
          <SettingsRow label="Install ID" description="Anonymous identifier for this panel.">
            <CopyField value={telemetry.installId} copied={copied} onCopy={copyInstallId} label="Copy install ID" />
          </SettingsRow>
        ) : null}
      </SettingsCard>

      <SettingsCard title="What gets sent">
        <div className="grid gap-6 px-5 py-5 sm:px-6 md:grid-cols-[1.6fr_1fr]">
          <List title="Shared" items={COLLECTED} icon={<Check className="mt-0.5 size-4 shrink-0 text-status-running" />} />
          <List title="Never shared" items={NEVER_COLLECTED} icon={<X className="mt-0.5 size-4 shrink-0 text-status-error" />} />
        </div>
      </SettingsCard>
    </div>
  );
}

function List({ title, items, icon }: { title: string; items: string[]; icon: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[13px] font-medium text-foreground">{title}</p>
      <ul className="space-y-2 text-sm">
        {items.map((line) => (
          <li key={line} className="flex gap-2.5">
            {icon}
            <span className="text-muted-foreground">{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
