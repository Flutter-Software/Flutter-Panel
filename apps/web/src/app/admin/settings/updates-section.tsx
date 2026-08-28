"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, Terminal, X } from "lucide-react";
import { Button } from "@mantine/core";
import { AdminSection } from "@/components/admin-create";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

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
  const [showLog, setShowLog] = useState(false);

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
        "Build the latest GitHub release in a staging folder first. The live panel is only replaced if install and compile succeed.",
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
            onClick={() => setShowLog(true)}
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
          onClick={() => void onUpdate()}
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

      <UpdateConsoleModal
        open={showLog}
        onClose={() => setShowLog(false)}
        running={running}
        job={status?.job ?? { state: "idle", log: [] }}
      />
    </AdminSection>
  );
}

function UpdateConsoleModal({
  open,
  onClose,
  running,
  job,
}: {
  open: boolean;
  onClose: () => void;
  running: boolean;
  job: UpdateJob;
}) {
  const scroller = useRef<HTMLPreElement>(null);
  const log = job.log.join("\n");

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [log, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        className="no-press absolute inset-0 bg-background/80 backdrop-blur-sm"
        aria-label="Close updater console"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Updater console"
        className="relative flex h-[min(88vh,48rem)] w-full max-w-5xl flex-col overflow-visible rounded-xl border border-border bg-black shadow-2xl"
      >
        <button
          type="button"
          className="absolute -right-3 -top-3 z-10 flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-md hover:bg-muted hover:text-foreground"
          aria-label="Close"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
        <pre
          ref={scroller}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-all rounded-xl p-4 font-mono text-[12px] leading-5 text-zinc-300"
        >
          {job.log.length ? log : "No updater output yet. Start an update to stream logs here."}
          {running ? <span className="ml-0.5 inline-block animate-pulse text-primary">▋</span> : null}
        </pre>
      </div>
    </div>
  );
}
