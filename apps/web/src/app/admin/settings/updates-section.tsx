"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Terminal } from "lucide-react";
import { Button } from "@mantine/core";
import { AdminSection } from "@/components/admin-create";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useLiveReload, usePanelEvent } from "@/components/panel-socket";
import {
  UpdateConsoleModal,
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
  const [showLog, setShowLog] = useState(false);
  const [consoleIntent, setConsoleIntent] = useState<"wizard" | "logs">("logs");

  const load = useCallback(async () => {
    const result = await api<{ data: UpdateStatus }>("/api/v1/admin/settings/update");
    setStatus(result.data);
    return result.data;
  }, []);

  useEffect(() => {
    setChecking(true);
    void load()
      .catch((err) => setError(err instanceof Error ? err.message : "Could not check for updates"))
      .finally(() => setChecking(false));
  }, [load]);

  usePanelEvent("update.job", (payload) => {
    setStatus((current) => (current ? { ...current, job: payload as UpdateJob } : current));
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

  function openConsole(intent: "wizard" | "logs") {
    setConsoleIntent(intent);
    setShowLog(true);
  }

  async function onStart(options: UpdateOptions) {
    setError(null);
    setStarting(true);
    try {
      await api("/api/v1/admin/settings/update", {
        method: "POST",
        body: JSON.stringify(options),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start update");
    } finally {
      setStarting(false);
    }
  }

  const running = status?.job.state === "running" || starting;
  const job = status?.job ?? { state: "idle" as const, log: [] };
  const wizard = shouldOpenUpdaterWizard(consoleIntent, job);
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

      <div className="grid gap-3 overflow-visible text-sm sm:grid-cols-2">
        <div className="relative overflow-visible rounded-lg border border-border px-3 py-3">
          <p className="text-xs text-muted-foreground">This install</p>
          <p className="mt-1 font-medium">v{status?.version ?? "…"}</p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            {status?.currentShortSha || "unknown revision"}
          </p>
          <button
            type="button"
            className={cn(
              "absolute -bottom-3 -right-3 z-10 flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-md hover:bg-muted hover:text-foreground",
              showLog && "border-primary/50 text-foreground",
            )}
            aria-label="Open updater console"
            onClick={() => openConsole("logs")}
          >
            <Terminal className="size-4" />
            {running ? (
              <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
            ) : status?.job.state === "failed" ? (
              <span className="absolute right-1 top-1 size-1.5 rounded-full bg-destructive" />
            ) : null}
          </button>
        </div>
        <div className="rounded-lg border border-border px-3 py-3">
          <p className="text-xs text-muted-foreground">GitHub {status?.ref ?? "main"}</p>
          <p className="mt-1 font-medium">{status?.latest.message || "Checking…"}</p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            {status?.latest.shortSha || "—"}
            {status?.latest.date ? ` · ${shortDate(status.latest.date)}` : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="default" disabled={checking || running} onClick={() => void onCheck()}>
          {checking ? "Checking…" : "Check for updates"}
        </Button>
        <Button
          type="button"
          disabled={running || !status?.canUpdate || !status.updateAvailable}
          onClick={() => openConsole("wizard")}
        >
          {running ? "Updating…" : "Update now"}
        </Button>
      </div>

      {status?.job.state === "ok" ? (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
          Update finished. Reload this page after the panel comes back. If services did not restart
          automatically, run <span className="font-mono">sudo /usr/local/sbin/flutter-restart</span>.
        </p>
      ) : null}
      {status?.job.state === "failed" && status.job.error ? (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-destructive">
          {status.job.error}
        </p>
      ) : null}
      {status && !status.canUpdate && status.blockedReason ? (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          {status.blockedReason}
        </p>
      ) : null}

      <UpdateConsoleModal
        open={showLog}
        onClose={() => setShowLog(false)}
        running={running}
        job={job}
        status={status}
        wizard={wizard}
        starting={starting}
        onStart={(options) => void onStart(options)}
      />
    </div>
  );

  if (!framed) return body;
  return (
    <AdminSection icon={<RefreshCw className="size-4" />} title="Updates" description={description}>
      {body}
    </AdminSection>
  );
}
