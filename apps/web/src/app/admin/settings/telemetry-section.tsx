"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, Switch } from "@mantine/core";
import { SettingsActions } from "./workspace";

export type TelemetryPublic = {
  enabled: boolean;
  envDisabled: boolean;
  installId: string | null;
  sending: boolean;
};

export function TelemetrySection({
  telemetry,
  pending,
  onSave,
}: {
  telemetry: TelemetryPublic | undefined;
  pending: boolean;
  onSave: (enabled: boolean) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!telemetry) return;
    setEnabled(telemetry.enabled);
  }, [telemetry]);

  const locked = Boolean(telemetry?.envDisabled);

  function submit(event: FormEvent) {
    event.preventDefault();
    void onSave(enabled);
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      {!locked && telemetry?.sending ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-muted-foreground">
          Anonymous telemetry is on. Flutter receives an install id, panel version, operating system,
          counts, file-download outcomes, and error reports with the message and stack trace.
          Emails, passwords, tokens, and database URLs are removed before sending. Turn the switch off
          to stop sharing.
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3">
        <div>
          <p className="text-sm font-medium">Share anonymous telemetry</p>
          <p className="text-xs text-muted-foreground">
            Helps fix crashes. Reports include the error message and stack trace. Emails, passwords,
            tokens, and database URLs are removed.
          </p>
        </div>
        <Switch
          checked={locked ? false : enabled}
          disabled={locked}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
          aria-label="Share anonymous telemetry"
        />
      </div>

      {locked ? (
        <p className="text-sm text-muted-foreground">
          Telemetry is turned off by <code className="font-mono text-xs">TELEMETRY_DISABLED</code> on this
          panel host.
        </p>
      ) : null}

      <div className="rounded-xl border border-border bg-background px-4 py-3">
        <p className="text-sm font-medium">What we collect</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>A random install ID, panel version, Node.js runtime, and OS/architecture</li>
          <li>Counts of servers, nodes, users, and eggs — not names</li>
          <li>Whether mail, SSO, and Redis are enabled</li>
          <li>File download success or failure, plus a short message when it fails</li>
          <li>API errors: message, stack trace, status, route template, and request id</li>
          <li>Background failures such as install, power, schedules, and mail</li>
          <li>Browser crashes and unhandled promise rejections</li>
          <li>Stack traces can include file paths on this machine</li>
        </ul>
      </div>

      {telemetry?.installId ? (
        <div className="rounded-xl border border-border bg-background px-4 py-3">
          <p className="text-sm font-medium">Install ID</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Anonymous identifier for this panel. Not tied to your domain.</p>
          <code className="mt-2 block truncate rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs">
            {telemetry.installId}
          </code>
        </div>
      ) : null}

      <SettingsActions>
        <Button type="submit" disabled={pending || locked} className="ml-auto">
          {pending ? "Saving…" : "Save telemetry"}
        </Button>
      </SettingsActions>
    </form>
  );
}
