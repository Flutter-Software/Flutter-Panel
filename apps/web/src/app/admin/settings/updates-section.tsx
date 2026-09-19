"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@mantine/core";
import { AdminSection } from "@/components/admin-create";
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
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid min-w-0 flex-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">This install</p>
            <p className="mt-1 font-medium">v{status?.version ?? "…"}</p>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {status?.currentShortSha || "unknown revision"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">GitHub {status?.ref ?? "main"}</p>
            <p className="mt-1 font-medium">{status?.latest.message || "Checking…"}</p>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {status?.latest.shortSha || "—"}
              {status?.latest.date ? ` · ${shortDate(status.latest.date)}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasLog && !running ? (
            <Button
              type="button"
              variant="default"
              onClick={() => setConsoleIntent(wizard ? "logs" : "wizard")}
            >
              {wizard ? "View last log" : "Start another update"}
            </Button>
          ) : null}
          <Button type="button" variant="default" disabled={checking || running} onClick={() => void onCheck()}>
            {checking ? "Checking…" : "Check for updates"}
          </Button>
        </div>
      </div>

      {status?.job.state === "ok" && !wizard ? (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
          Update finished. Reload this page after the panel comes back. If services did not restart
          automatically, run <span className="font-mono">sudo /usr/local/sbin/flutter-restart</span>.
        </p>
      ) : null}
      {status?.job.state === "failed" && status.job.error && !wizard ? (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-destructive">
          {status.job.error}
        </p>
      ) : null}

      <div className="-mx-5 -mb-5 overflow-hidden border-t border-border sm:-mx-6 sm:-mb-6">
        <UpdateConsole
          running={running}
          job={job}
          status={status}
          wizard={wizard}
          starting={starting}
          onStart={(options) => void onStart(options)}
        />
      </div>
    </div>
  );

  if (!framed) return body;
  return (
    <AdminSection icon={<RefreshCw className="size-4" />} title="Updates" description={description}>
      {body}
    </AdminSection>
  );
}
