"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@mantine/core";
import { AdminSection } from "@/components/admin-create";
import { Card } from "@/components/ui";
import { api } from "@/lib/api";
import { useLiveReload, usePanelEvent } from "@/components/panel-socket";
import {
  UpdateConsole,
  shouldOpenUpdaterWizard,
  type UpdateJob,
  type UpdateOptions,
  type UpdateStatus,
} from "./updates-console";

function shortDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function UpdatesSection({ framed = true }: { framed?: boolean }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [consoleIntent, setConsoleIntent] = useState<"wizard" | "logs">("wizard");

  const load = useCallback(async () => {
    const result = await api<{ data: UpdateStatus }>("/api/v1/admin/settings/update");
    setStatus(result.data);
    return result.data;
  }, []);

  useEffect(() => {
    setChecking(true);
    void load()
      .then((next) => {
        if (next.job.state === "running" || next.job.log.length) setConsoleIntent("logs");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not check for updates"))
      .finally(() => setChecking(false));
  }, [load]);

  usePanelEvent("update.job", (payload) => {
    const job = payload as UpdateJob;
    setStatus((current) => (current ? { ...current, job } : current));
    if (job.state === "running") setConsoleIntent("logs");
  });
  useLiveReload(load, 1500, status?.job.state === "running");

  async function onCheck() {
    setError(null);
    setChecking(true);
    try {
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check for updates");
    } finally {
      setChecking(false);
    }
  }

  async function onStart(options: UpdateOptions) {
    setError(null);
    setStarting(true);
    setConsoleIntent("logs");
    try {
      await api("/api/v1/admin/settings/update", {
        method: "POST",
        body: JSON.stringify(options),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start update");
      setConsoleIntent("wizard");
    } finally {
      setStarting(false);
    }
  }

  const running = status?.job.state === "running" || starting;
  const job = status?.job ?? { state: "idle" as const, log: [] };
  const wizard = shouldOpenUpdaterWizard(consoleIntent, job);
  const hasLog = job.log.length > 0 || job.state === "ok" || job.state === "failed";
  const description = status?.updateAvailable
    ? "A newer panel build is available from GitHub."
    : status?.checkError
      ? status.checkError
      : "This panel is up to date.";

  const body = (
    <div className="space-y-5">
      {error ? (
        <p className="rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error">
          {error}
        </p>
      ) : null}

      <Card className="overflow-hidden">
        {/* Side-by-side "installed vs latest" comparison, the core question this page answers. */}
        <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <VersionTile
            label="Installed"
            primary={`v${status?.version ?? "…"}`}
            secondary={status?.currentShortSha || "unknown revision"}
          />
          <VersionTile
            label={`Latest on ${status?.ref ?? "main"}`}
            primary={status?.latest.message || (checking ? "Checking…" : "—")}
            secondary={
              `${status?.latest.shortSha || "—"}${status?.latest.date ? ` · ${shortDate(status.latest.date)}` : ""}`
            }
            highlight={Boolean(status?.updateAvailable)}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/25 px-5 py-3 sm:px-6">
          {hasLog && !running ? (
            <Button
              type="button"
              variant="subtle"
              color="gray"
              onClick={() => setConsoleIntent(wizard ? "logs" : "wizard")}
            >
              {wizard ? "View last log" : "Start another update"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="default"
            loading={checking}
            disabled={running}
            leftSection={<RefreshCw className="size-3.5" />}
            onClick={() => void onCheck()}
          >
            Check for updates
          </Button>
        </div>
      </Card>

      {status?.job.state === "ok" && !wizard ? (
        <p className="rounded-lg border border-status-running/30 bg-status-running/10 px-3 py-2 text-sm">
          Update finished. Reload this page after the panel comes back. If services did not restart
          automatically, run <span className="font-mono">sudo /usr/local/sbin/flutter-restart</span>.
        </p>
      ) : null}
      {status?.job.state === "failed" && status.job.error && !wizard ? (
        <p className="rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error">
          {status.job.error}
        </p>
      ) : null}

      <Card className="overflow-hidden">
        <UpdateConsole
          running={running}
          job={job}
          status={status}
          wizard={wizard}
          starting={starting}
          onStart={(options) => void onStart(options)}
        />
      </Card>
    </div>
  );

  if (!framed) return body;
  return (
    <AdminSection icon={<RefreshCw className="size-4" />} title="Updates" description={description}>
      {body}
    </AdminSection>
  );
}

function VersionTile({
  label,
  primary,
  secondary,
  highlight = false,
}: {
  label: string;
  primary: string;
  secondary: string;
  highlight?: boolean;
}) {
  return (
    <div className="min-w-0 px-5 py-4 sm:px-6">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {label}
        {highlight ? (
          <span className="rounded-full bg-status-warn/15 px-1.5 py-0.5 text-[10px] font-semibold text-status-warn">
            NEW
          </span>
        ) : null}
      </p>
      <p className="mt-1.5 truncate font-semibold" title={primary}>
        {primary}
      </p>
      <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{secondary}</p>
    </div>
  );
}
