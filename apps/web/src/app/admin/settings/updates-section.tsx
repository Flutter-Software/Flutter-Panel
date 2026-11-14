"use client";

/**
 * Settings → Updates.
 *
 * Deliberately plain, like the updaters in commercial hosting panels:
 *
 *   1. A status card answers "am I up to date?" with one primary action.
 *   2. Two options (migrations, daemon restart) sit in their own card and
 *      default to on, so most admins never touch them.
 *   3. While an update runs, the status card shows a progress bar and the
 *      step list. The raw log is tucked behind "Show log" and opens by itself
 *      when an update fails.
 *
 * The update itself runs server-side; this component only starts it and
 * follows `update.job` socket events (with polling as a fallback, because the
 * socket drops while the panel restarts).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  Loader2,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react";
import { Button, Switch } from "@mantine/core";
import { Card } from "@/components/ui";
import { confirm } from "@/components/confirm-dialog";
import { useLiveReload, usePanelEvent } from "@/components/panel-socket";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ansiSpans, stripConsoleAnsi } from "@/lib/console-ansi";
import { SettingsCard, SettingsToggleRow } from "./workspace";

/* ---- API shapes (mirror apps/api updater) ------------------------------------ */

export type UpdatePhase = "preparing" | "packages" | "database" | "building" | "promoting" | "restarting";

export type UpdateOptions = {
  applySchema: boolean;
  restartDaemon: boolean;
};

export type UpdateJob = {
  state: "idle" | "running" | "ok" | "failed";
  log: string[];
  startedAt?: string;
  finishedAt?: string;
  error?: string | null;
  sha?: string;
  version?: string;
  phase?: UpdatePhase | null;
  activity?: string | null;
  options?: UpdateOptions | null;
};

export type UpdateStatus = {
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

/* ---- Phases ------------------------------------------------------------------- */

const PHASES: { id: UpdatePhase; title: string }[] = [
  { id: "preparing", title: "Download" },
  { id: "packages", title: "Install packages" },
  { id: "database", title: "Migrate database" },
  { id: "building", title: "Build" },
  { id: "promoting", title: "Go live" },
  { id: "restarting", title: "Restart" },
];

type StepState = "pending" | "current" | "done" | "failed";

/** The database step only exists when migrations were requested. */
function visiblePhases(applySchema: boolean) {
  return PHASES.filter((phase) => phase.id !== "database" || applySchema);
}

/** Where each step stands, derived from the job's current phase and state. */
function stepStates(job: UpdateJob, applySchema: boolean): StepState[] {
  const list = visiblePhases(applySchema);
  const current = Math.max(
    0,
    list.findIndex((phase) => phase.id === job.phase),
  );
  return list.map((_, index) => {
    if (job.state === "ok") return "done";
    if (index < current) return "done";
    if (index > current) return "pending";
    return job.state === "failed" ? "failed" : "current";
  });
}

const DEFAULT_OPTIONS: UpdateOptions = { applySchema: true, restartDaemon: true };
const IDLE_JOB: UpdateJob = { state: "idle", log: [] };

/* ---- Small helpers ------------------------------------------------------------ */

/** "3 hours ago" style, falling back to the raw string if it isn't a date. */
function timeAgo(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return value;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(-Math.round(seconds / size), unit);
  }
  return "just now";
}

/* ---- Component ---------------------------------------------------------------- */

export function UpdatesSection({ onStatus }: { onStatus?: (status: UpdateStatus) => void }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [starting, setStarting] = useState(false);
  const [options, setOptions] = useState<UpdateOptions>(DEFAULT_OPTIONS);
  const [showLog, setShowLog] = useState(false);
  /** finishedAt of the result banner the admin closed, so it stays closed. */
  const [dismissed, setDismissed] = useState<string | null>(null);

  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  const load = useCallback(async () => {
    const result = await api<{ data: UpdateStatus }>("/api/v1/admin/settings/update");
    setStatus(result.data);
    onStatusRef.current?.(result.data);
    return result.data;
  }, []);

  useEffect(() => {
    void load()
      .catch((err) => setError(err instanceof Error ? err.message : "Could not check for updates"))
      .finally(() => setChecking(false));
  }, [load]);

  usePanelEvent("update.job", (payload) => {
    const job = payload as UpdateJob;
    setStatus((current) => {
      if (!current) return current;
      const next = { ...current, job };
      onStatusRef.current?.(next);
      return next;
    });
  });

  // Polling fallback while running; failures are expected while the panel restarts.
  useLiveReload(() => load().catch(() => undefined), 1500, status?.job.state === "running");

  const job = status?.job ?? IDLE_JOB;
  const running = job.state === "running" || starting;
  const finished = (job.state === "ok" || job.state === "failed") && (job.finishedAt ?? "") !== dismissed;

  // A failed update almost always needs the log, so open it for them.
  useEffect(() => {
    if (job.state === "failed") setShowLog(true);
  }, [job.state]);

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
    const ok = await confirm({
      title: "Update the panel now?",
      description:
        "The latest build is downloaded and built alongside the live install, then swapped in. The panel restarts at the end and is unavailable for about a minute.",
      confirmLabel: "Update now",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    setError(null);
    setStarting(true);
    setDismissed(null);
    try {
      await api("/api/v1/admin/settings/update", { method: "POST", body: JSON.stringify(options) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the update");
    } finally {
      setStarting(false);
    }
  }

  const applySchema = job.options?.applySchema ?? options.applySchema;
  const canStart = Boolean(status && (status.updateAvailable || status.checkError));

  return (
    <div className="space-y-5">
      {error ? <Banner tone="error" title={error} /> : null}

      {finished && job.state === "ok" ? (
        <Banner
          tone="ok"
          title={`Update complete${job.version ? ` — now running v${job.version}` : ""}.`}
          onDismiss={() => setDismissed(job.finishedAt ?? "")}
          action={
            <Button size="xs" variant="default" onClick={() => window.location.reload()}>
              Reload panel
            </Button>
          }
        >
          If the panel didn&apos;t come back on its own, run{" "}
          <code className="font-mono text-xs">sudo /usr/local/sbin/flutter-restart</code> on the host.
        </Banner>
      ) : null}
      {finished && job.state === "failed" ? (
        <Banner tone="error" title="The update failed." onDismiss={() => setDismissed(job.finishedAt ?? "")}>
          {job.error || "See the log below for what went wrong."}
        </Banner>
      ) : null}

      {/* ---- Status ---------------------------------------------------------- */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:px-6">
          <StatusIcon status={status} running={running} checking={checking} />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">{headline(status, running, checking)}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">{subline(status, running)}</p>
          </div>
          {!running ? (
            <div className="flex shrink-0 gap-2">
              <Button
                variant="default"
                loading={checking}
                leftSection={<RefreshCw className="size-3.5" />}
                onClick={() => void onCheck()}
              >
                Check again
              </Button>
              {canStart ? (
                <Button disabled={!status?.canUpdate} onClick={() => void onUpdate()}>
                  {status?.updateAvailable ? "Update now" : "Update anyway"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {running ? <Progress job={job} applySchema={applySchema} /> : null}

        {status ? (
          <dl className="grid divide-y divide-border border-t border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <Fact label="Installed" value={`v${status.version}`} detail={status.currentShortSha || "unknown revision"} />
            <Fact
              label="Latest"
              value={status.latest.shortSha || "—"}
              detail={status.latest.date ? timeAgo(status.latest.date) : status.latest.message || "—"}
              link={status.latest.url || undefined}
            />
            <Fact label="Branch" value={status.ref} detail={status.repo} />
          </dl>
        ) : null}

        {status?.blockedReason ? (
          <div className="flex items-start gap-2 border-t border-border bg-status-warn/10 px-5 py-3 text-sm text-status-warn sm:px-6">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{status.blockedReason}</span>
          </div>
        ) : null}
      </Card>

      {/* ---- Options (only when there is something to install) --------------- */}
      {canStart && !running ? (
        <SettingsCard title="Update options" description="The defaults are right for almost every install.">
          <SettingsToggleRow
            title="Run database migrations"
            description="Applies schema changes that ship with the new version. Leave on unless you manage the database yourself."
            control={
              <Switch
                checked={options.applySchema}
                onChange={(event) => {
                  const applySchema = event.currentTarget.checked;
                  setOptions((current) => ({ ...current, applySchema }));
                }}
                aria-label="Run database migrations"
              />
            }
          />
          <SettingsToggleRow
            title="Restart the node daemon on this machine"
            description="Only affects a daemon installed on the same host as the panel. Running game servers are not stopped."
            control={
              <Switch
                checked={options.restartDaemon}
                onChange={(event) => {
                  const restartDaemon = event.currentTarget.checked;
                  setOptions((current) => ({ ...current, restartDaemon }));
                }}
                aria-label="Restart the node daemon on this machine"
              />
            }
          />
        </SettingsCard>
      ) : null}

      {/* ---- Log ------------------------------------------------------------- */}
      {job.log.length > 0 || running ? (
        <UpdateLog lines={job.log} running={running} open={showLog} onToggle={() => setShowLog((open) => !open)} />
      ) : null}
    </div>
  );
}

/* ---- Status copy ---------------------------------------------------------------- */

function headline(status: UpdateStatus | null, running: boolean, checking: boolean) {
  if (running) return "Updating…";
  if (!status) return checking ? "Checking for updates…" : "Update status unavailable";
  if (status.updateAvailable) return "A new version is available";
  if (status.checkError) return "Couldn't check for updates";
  return "You're up to date";
}

function subline(status: UpdateStatus | null, running: boolean) {
  if (running) return "This keeps running if you leave the page. The panel restarts at the end.";
  if (!status) return "Comparing this install with the latest build.";
  if (status.updateAvailable) return status.latest.message || `New commits on ${status.ref}.`;
  if (status.checkError) return status.checkError;
  return `v${status.version} is the latest build on ${status.ref}.`;
}

function StatusIcon({
  status,
  running,
  checking,
}: {
  status: UpdateStatus | null;
  running: boolean;
  checking: boolean;
}) {
  const [Icon, tone, spin] =
    running || (checking && !status)
      ? [Loader2, "bg-status-info/12 text-status-info", true]
      : status?.updateAvailable
        ? [ArrowUpCircle, "bg-primary/12 text-primary", false]
        : status?.checkError || !status
          ? [CircleAlert, "bg-status-warn/12 text-status-warn", false]
          : [CheckCircle2, "bg-status-running/12 text-status-running", false];
  return (
    <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-full", tone)}>
      <Icon className={cn("size-5", spin && "animate-spin")} />
    </span>
  );
}

/* ---- Pieces ---------------------------------------------------------------------- */

function Fact({ label, value, detail, link }: { label: string; value: string; detail: string; link?: string }) {
  return (
    <div className="min-w-0 px-5 py-3.5 sm:px-6">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex items-center gap-1.5 font-mono text-sm font-medium">
        <span className="truncate">{value}</span>
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label="View commit on GitHub"
          >
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </dd>
      <dd className="mt-0.5 truncate text-xs text-muted-foreground" title={detail}>
        {detail}
      </dd>
    </div>
  );
}

/** Progress bar + step list shown inside the status card while updating. */
function Progress({ job, applySchema }: { job: UpdateJob; applySchema: boolean }) {
  const phases = visiblePhases(applySchema);
  const states = stepStates(job, applySchema);
  const done = states.filter((state) => state === "done").length;
  const currentIndex = states.findIndex((state) => state === "current");
  // Count the step in progress as half done so the bar never sits still at 0%.
  const percent = Math.round(((done + (currentIndex >= 0 ? 0.5 : 0)) / phases.length) * 100);
  const current = phases[currentIndex >= 0 ? currentIndex : 0];

  return (
    <div className="space-y-3 border-t border-border px-5 py-5 sm:px-6">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="font-medium">{current.title}</span>
        <span className="tabular-nums text-muted-foreground">{percent}%</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Update progress"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${percent}%` }} />
      </div>
      {job.activity ? <p className="truncate text-xs text-muted-foreground">{job.activity}</p> : null}
      <ol className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
        {phases.map((phase, index) => {
          const state = states[index];
          return (
            <li
              key={phase.id}
              className={cn(
                "flex items-center gap-1.5 text-xs",
                state === "pending" && "text-muted-foreground/70",
                state === "done" && "text-muted-foreground",
                state === "current" && "font-medium text-foreground",
                state === "failed" && "text-status-error",
              )}
            >
              {state === "done" ? (
                <Check className="size-3.5 text-status-running" />
              ) : state === "current" ? (
                <Loader2 className="size-3.5 animate-spin text-primary" />
              ) : state === "failed" ? (
                <X className="size-3.5" />
              ) : (
                <span className="size-1.5 rounded-full bg-current" />
              )}
              {phase.title}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Collapsible raw output. Sticks to the bottom unless the admin scrolls up. */
function UpdateLog({
  lines,
  running,
  open,
  onToggle,
}: {
  lines: string[];
  running: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && open && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines, open]);

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left text-sm outline-none transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 sm:px-6"
      >
        <span className="font-medium">
          {open ? "Hide log" : "Show log"}
          <span className="ml-2 font-normal text-muted-foreground">{lines.length} lines</span>
        </span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div
          ref={scroller}
          onScroll={(event) => {
            const el = event.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
          className="h-80 overflow-y-auto border-t border-border bg-black px-4 py-3 font-mono text-[12px] leading-5 text-zinc-300"
        >
          {lines.length ? (
            lines.map((line, index) => <LogLine key={index} line={line} />)
          ) : (
            <p className="text-zinc-500">Waiting for output…</p>
          )}
          {running ? <span className="inline-block animate-pulse text-primary">▋</span> : null}
        </div>
      ) : null}
    </Card>
  );
}

function LogLine({ line }: { line: string }) {
  const plain = stripConsoleAnsi(line);
  const banner = plain.startsWith("╔") || plain.startsWith("║") || plain.startsWith("╚");
  const spans = ansiSpans(line);
  return (
    <div className={cn("whitespace-pre-wrap break-all", banner && "font-semibold text-primary")}>
      {spans.length
        ? spans.map((span, index) => (
            <span key={index} className={span.className || undefined}>
              {span.text}
            </span>
          ))
        : line}
    </div>
  );
}

/** Inline result / error message above the status card. */
function Banner({
  tone,
  title,
  action,
  onDismiss,
  children,
}: {
  tone: "ok" | "error";
  title: string;
  action?: ReactNode;
  onDismiss?: () => void;
  children?: ReactNode;
}) {
  const Icon = tone === "ok" ? CheckCircle2 : XCircle;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
        tone === "ok"
          ? "border-status-running/30 bg-status-running/10"
          : "border-status-error/30 bg-status-error/10",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "ok" ? "text-status-running" : "text-status-error")} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {children ? <p className="mt-0.5 text-muted-foreground">{children}</p> : null}
      </div>
      {action}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
