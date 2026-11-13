"use client";

/**
 * Version banner for the admin dashboard.
 *
 * Reads `/api/v1/admin/settings/update` (the same endpoint the Settings →
 * Updates section uses) and collapses its response into one tinted card:
 *
 *   running  → blue,  an update job is in progress
 *   failed   → red,   the last update job failed and the panel is still behind
 *   error    → amber, the GitHub check itself failed (rate limit, offline…)
 *   outdated → amber, a newer commit exists on the tracked ref
 *   current  → green, the panel matches the tracked ref
 *
 * Every state links to Settings → Updates, where the admin can act on it.
 * The banner never blocks the dashboard: while the check is pending (it can
 * take a few seconds when the API has to reach GitHub) a neutral placeholder
 * of the same height is shown so the layout does not jump.
 */

import Link from "next/link";
import { useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  ChevronRight,
  CircleArrowUp,
  CircleCheck,
  CircleX,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useQuery } from "@/lib/query";
import { usePanelEvent } from "@/components/panel-socket";

/** Subset of the API's `getUpdateStatus()` payload that the banner reads. */
export type UpdateStatus = {
  version: string;
  currentShortSha?: string;
  ref?: string;
  updateAvailable: boolean;
  checkError?: string | null;
  latest: { message: string; shortSha: string };
  job?: {
    state: "idle" | "running" | "ok" | "failed";
    error?: string | null;
    activity?: string | null;
  };
};

type Tone = "running" | "failed" | "error" | "outdated" | "current";

/**
 * Per-tone styling. Colours come from the panel's status tokens in
 * globals.css, so the banner follows custom branding and dark/light themes.
 */
const TONES: Record<
  Tone,
  { icon: ComponentType<{ className?: string }>; card: string; iconClass: string; spin?: boolean }
> = {
  running: {
    icon: LoaderCircle,
    card: "border-status-info/40 border-l-status-info bg-status-info/10",
    iconClass: "text-status-info",
    spin: true,
  },
  failed: {
    icon: CircleX,
    card: "border-status-error/40 border-l-status-error bg-status-error/10",
    iconClass: "text-status-error",
  },
  error: {
    icon: TriangleAlert,
    card: "border-status-warn/40 border-l-status-warn bg-status-warn/10",
    iconClass: "text-status-warn",
  },
  outdated: {
    icon: CircleArrowUp,
    card: "border-status-warn/40 border-l-status-warn bg-status-warn/10",
    iconClass: "text-status-warn",
  },
  current: {
    icon: CircleCheck,
    card: "border-status-running/40 border-l-status-running bg-status-running/10",
    iconClass: "text-status-running",
  },
};

const UPDATE_PATH = "/api/v1/admin/settings/update";

export function VersionBanner() {
  const query = useQuery<{ data: UpdateStatus }>(UPDATE_PATH);

  // The updater broadcasts `update.job` on every log line. Track the job
  // locally so the banner reacts instantly, and only re-fetch the full status
  // once a running job settles (that is when "behind" can become "current").
  const [liveJob, setLiveJob] = useState<UpdateStatus["job"]>();
  const lastState = useRef<string | undefined>(undefined);
  usePanelEvent("update.job", (payload) => {
    const job = payload as NonNullable<UpdateStatus["job"]>;
    setLiveJob(job);
    if (lastState.current === "running" && job.state !== "running") void query.reload();
    lastState.current = job.state;
  });

  const status = query.data?.data;

  if (!status) {
    // Request failed outright (API down, 403…): say so instead of spinning forever.
    if (query.error) {
      return (
        <Banner
          tone="error"
          title="Couldn't check for updates."
          body={query.error}
          action="Open updates"
        />
      );
    }
    return <BannerPlaceholder />;
  }

  const version = <VersionText version={status.version} sha={status.currentShortSha} />;
  const job = liveJob ?? status.job;

  if (job?.state === "running") {
    return (
      <Banner
        tone="running"
        title="Updating your panel…"
        body={job.activity || "An update is being applied. The panel may restart briefly."}
        action="View progress"
      />
    );
  }

  if (job?.state === "failed" && status.updateAvailable) {
    return (
      <Banner
        tone="failed"
        title="The last update failed."
        body={
          <>
            {job.error || "The update job exited with an error."} You are still running {version}.
          </>
        }
        action="View logs"
      />
    );
  }

  if (status.checkError) {
    return (
      <Banner
        tone="error"
        title="Couldn't check for updates."
        body={
          <>
            {status.checkError} You are running {version}.
          </>
        }
        action="Open updates"
      />
    );
  }

  if (status.updateAvailable) {
    const latest = status.latest;
    return (
      <Banner
        tone="outdated"
        title="A panel update is available."
        body={
          <>
            You are running {version}. Latest
            {latest.shortSha ? <Mono> {latest.shortSha}</Mono> : null}
            {latest.message ? <>: {latest.message}</> : "."}
          </>
        }
        action="Review update"
      />
    );
  }

  return (
    <Banner
      tone="current"
      title="Your panel is up to date."
      body={<>You are running {version}.</>}
      action="Manage updates"
    />
  );
}

/** "version 0.2.72 (abc1234)" with the numbers in monospace, like the reference. */
function VersionText({ version, sha }: { version: string; sha?: string }) {
  return (
    <>
      version <Mono>{version}</Mono>
      {sha ? (
        <>
          {" "}
          (<Mono>{sha}</Mono>)
        </>
      ) : null}
    </>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[0.92em] text-foreground">{children}</span>;
}

function Banner({
  tone,
  title,
  body,
  action,
}: {
  tone: Tone;
  title: string;
  body: ReactNode;
  action: string;
}) {
  const meta = TONES[tone];
  const Icon = meta.icon;
  return (
    <Link
      href="/admin/settings#updates"
      // role="status" lets screen readers announce state changes (e.g. update finished).
      role="status"
      className={cn(
        "group flex items-center gap-3 rounded-xl border border-l-4 px-4 py-3.5 transition-colors hover:brightness-110",
        meta.card,
      )}
    >
      <Icon className={cn("size-5 shrink-0", meta.iconClass, meta.spin && "animate-spin")} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-sm break-words text-muted-foreground">{body}</p>
      </div>
      <span className="hidden shrink-0 items-center gap-0.5 text-xs font-medium text-muted-foreground group-hover:text-foreground sm:inline-flex">
        {action}
        <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

/** Same footprint as a real banner so the dashboard doesn't shift when the check lands. */
function BannerPlaceholder() {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-xl border border-l-4 border-border bg-muted/30 px-4 py-3.5"
    >
      <LoaderCircle className="size-5 shrink-0 animate-spin text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">Checking for updates…</p>
        <p className="mt-0.5 text-sm text-muted-foreground">Comparing this install with the latest build.</p>
      </div>
    </div>
  );
}
