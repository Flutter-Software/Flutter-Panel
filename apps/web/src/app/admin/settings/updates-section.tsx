"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@mantine/core";
import { AdminSection } from "@/components/admin-create";
import { api } from "@/lib/api";

type UpdateJob = {
  state: "idle" | "running" | "ok" | "failed";
  log: string[];
  startedAt?: string;
  finishedAt?: string;
  error?: string | null;
};

type UpdateStatus = {
  version: string;
  repo: string;
  ref: string;
  currentSha: string;
  currentShortSha: string;
  latest: { sha: string; shortSha: string; message: string; date: string; url: string };
  updateAvailable: boolean;
  canUpdate: boolean;
  blockedReason: string | null;
  method: "git" | "clone";
  checkError: string | null;
  job: UpdateJob;
};

function shortDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function UpdatesSection() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);

  async function load() {
    const result = await api<{ data: UpdateStatus }>("/api/v1/admin/settings/update");
    setStatus(result.data);
    return result.data;
  }

  useEffect(() => {
    setChecking(true);
    void load()
      .catch((err) => setError(err instanceof Error ? err.message : "Could not check for updates"))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (status?.job.state !== "running") return;
    const timer = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [status?.job.state]);

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

  async function onUpdate() {
    if (
      !window.confirm(
        "Update the panel from GitHub? Tracked files are replaced with the latest main branch. .env and server data are kept.",
      )
    ) {
      return;
    }
    setError(null);
    setStarting(true);
    try {
      await api("/api/v1/admin/settings/update", { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start update");
    } finally {
      setStarting(false);
    }
  }

  const running = status?.job.state === "running" || starting;
  const description = status?.updateAvailable
    ? "A newer panel build is available from GitHub."
    : status?.checkError
      ? status.checkError
      : "This panel is up to date.";

  return (
    <AdminSection icon={<RefreshCw className="size-4" />} title="Updates" description={description}>
      {error ? (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}

      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-border px-3 py-3">
          <p className="text-xs text-muted-foreground">This install</p>
          <p className="mt-1 font-medium">v{status?.version ?? "…"}</p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            {status?.currentShortSha || "unknown revision"}
          </p>
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
          onClick={() => void onUpdate()}
        >
          {running ? "Updating…" : "Update now"}
        </Button>
      </div>

      {!status?.canUpdate && status ? (
        <p className="text-xs text-muted-foreground">
          {status.blockedReason || "In-place updates are disabled for this install."}
        </p>
      ) : null}

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

      {status?.job.log.length ? (
        <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-[11px] leading-5 text-muted-foreground">
          {status.job.log.join("\n")}
        </pre>
      ) : null}
    </AdminSection>
  );
}
