"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PANEL_VERSION } from "@flutter-software/shared";
import { Check, Cpu, HardDrive, Loader2, MemoryStick, RefreshCw, Server, Trash2, X } from "lucide-react";
import { AdminError } from "@/components/admin-table";
import { useAdminNode } from "@/components/node-frame";
import { confirm } from "@/components/confirm-dialog";
import { Button, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatGiB } from "@/lib/types";

function formatAgo(ageMs: number | null) {
  if (ageMs == null) return "never";
  if (ageMs < 1000) return "just now";
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s ago`;
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  return `${Math.floor(ageMs / 3_600_000)}h ago`;
}

type NodeHealth = {
  heartbeat: { online: boolean; lastHeartbeatAt: string | null; ageMs: number | null };
  panelReach: {
    ok: boolean;
    url: string | null;
    error: string | null;
    version: string | null;
    nodeId: string | null;
    docker: { ok: boolean; error?: string } | null;
  };
  config: {
    readable: boolean;
    path: string | null;
    listenPort: number | null;
    sftpPort: number | null;
    listenUrl: string | null;
    nodeId: string | null;
    issues: string[];
  };
  browserProbeUrl: string | null;
  ports: { daemon: number; sftp: number };
};

type CheckState = "ok" | "bad" | "wait" | "skip";

function CheckRow({
  label,
  state,
  detail,
}: {
  label: string;
  state: CheckState;
  detail: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <div className="min-w-0">
        <p className="font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
      <span
        className={cn(
          "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full",
          state === "ok" && "bg-status-running/15 text-status-running",
          state === "bad" && "bg-status-error/15 text-status-error",
          state === "wait" && "bg-muted text-muted-foreground",
          state === "skip" && "bg-muted text-muted-foreground",
        )}
      >
        {state === "wait" ? (
          <Loader2 className="size-3 animate-spin" />
        ) : state === "ok" ? (
          <Check className="size-3" />
        ) : (
          <X className="size-3" />
        )}
      </span>
    </div>
  );
}

function NodeHealthCard({ nodeId }: { nodeId: string }) {
  const [health, setHealth] = useState<NodeHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [browser, setBrowser] = useState<{ ok: boolean; detail: string } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    setBrowser(null);
    try {
      const result = await api<{ data: NodeHealth }>(`/api/v1/admin/nodes/${nodeId}/health`);
      const data = result.data;
      setHealth(data);
      const url = data.browserProbeUrl;
      if (!url) {
        setBrowser({ ok: false, detail: "No public daemon URL to probe" });
        return;
      }
      if (typeof window !== "undefined" && window.location.protocol === "https:" && url.startsWith("http:")) {
        setBrowser({ ok: false, detail: `Blocked: this page is HTTPS, daemon is ${url}` });
        return;
      }
      try {
        const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(4_000) });
        if (!response.ok) {
          setBrowser({ ok: false, detail: `${url} returned HTTP ${response.status}` });
          return;
        }
        setBrowser({ ok: true, detail: url });
      } catch {
        setBrowser({ ok: false, detail: `This browser cannot open ${url}` });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Health check failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [nodeId]);

  const heartbeat = health?.heartbeat;
  const panel = health?.panelReach;
  const config = health?.config;
  const configOk = Boolean(config?.readable && config.issues.length === 0);

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Health</h2>
        <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Check
        </Button>
      </div>
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      <div className="mt-4 space-y-3">
        <CheckRow
          label="Heartbeat"
          state={loading && !health ? "wait" : heartbeat?.online ? "ok" : "bad"}
          detail={
            heartbeat
              ? heartbeat.online
                ? `Daemon reached the panel ${formatAgo(heartbeat.ageMs)}`
                : heartbeat.lastHeartbeatAt
                  ? `Last seen ${formatAgo(heartbeat.ageMs)}`
                  : "No heartbeat yet"
              : "Checking…"
          }
        />
        <CheckRow
          label="Panel → daemon"
          state={loading && !health ? "wait" : panel?.ok ? "ok" : "bad"}
          detail={
            panel?.ok
              ? panel.docker && !panel.docker.ok
                ? `Reached ${panel.url}, Docker: ${panel.docker.error || "not connected"}`
                : `Reached ${panel.url}`
              : panel?.error || "Checking…"
          }
        />
        <CheckRow
          label="This browser → daemon"
          state={!browser ? "wait" : browser.ok ? "ok" : "bad"}
          detail={browser?.detail || "Checking…"}
        />
        <CheckRow
          label="Config"
          state={loading && !health ? "wait" : configOk ? "ok" : config?.readable ? "bad" : "skip"}
          detail={
            configOk
              ? `listen ${config?.listenPort} · SFTP ${config?.sftpPort}`
              : config?.issues[0] || "Not read yet"
          }
        />
      </div>
      {health ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Ports on this node: daemon {health.ports.daemon}/tcp, SFTP {health.ports.sftp}/tcp. Game allocations are
          still opened by you.
        </p>
      ) : null}
      {config?.issues && config.issues.length > 1 ? (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          {config.issues.slice(1).map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function Bar({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground/80">
          {formatGiB(used)} / {formatGiB(total)}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function NodeAboutPage() {
  const router = useRouter();
  const { node, reload } = useAdminNode();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!node) return null;

  const nodeId = node.id;
  const nodeName = node.name;

  const version = node.daemonVersion ? `v${node.daemonVersion.replace(/^v/, "")}` : "—";
  const latest = `v${PANEL_VERSION.replace(/^v/, "")}`;
  const threads = node.system.cpuThreads || node.cpuCores || 0;

  async function onDelete() {
    if (
      !(await confirm({
        title: "Delete node",
        description: `Delete ${nodeName}? This cannot be undone.`,
        confirmLabel: "Delete",
      }))
    ) {
      return;
    }
    setError(null);
    setPending(true);
    try {
      await api(`/api/v1/admin/nodes/${nodeId}`, { method: "DELETE" });
      router.push("/admin/nodes");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setPending(false);
      await reload();
    }
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[1.4fr_1fr]">
      <div className="space-y-4">
        <NodeHealthCard nodeId={nodeId} />
        <Card className="p-5 sm:p-6">
          <h2 className="text-sm font-semibold">Information</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-start justify-between gap-4">
              <dt className="text-muted-foreground">Daemon version</dt>
              <dd className="font-mono text-right">
                {version}{" "}
                <span className="text-muted-foreground">(latest: {latest})</span>
              </dd>
            </div>
            <div className="border-t border-border pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                System information
              </p>
              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Total CPU threads</span>
                  <span className="tabular-nums">{threads || "—"}</span>
                </div>
                {node.system.hostname ? (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">Hostname</span>
                    <span className="font-mono text-xs">{node.system.hostname}</span>
                  </div>
                ) : null}
                {node.system.platform ? (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">Operating system</span>
                    <span className="font-mono text-xs">
                      {node.system.platform}
                      {node.system.release ? ` ${node.system.release}` : ""}
                      {node.system.arch ? ` · ${node.system.arch}` : ""}
                    </span>
                  </div>
                ) : null}
                {node.system.totalMemoryMb ? (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">Host memory</span>
                    <span className="tabular-nums">{formatGiB(node.system.totalMemoryMb)}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </dl>
        </Card>

        <Card className="p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-destructive">Delete node</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Removes this machine from the panel. Servers on it must be deleted first.
          </p>
          <AdminError message={error} />
          <Button
            type="button"
            variant="danger"
            className="mt-4"
            disabled={pending || node.serverCount > 0}
            onClick={() => void onDelete()}
          >
            <Trash2 className="size-4" />
            {pending ? "Deleting…" : "Delete node"}
          </Button>
        </Card>
      </div>

      <Card className="p-5 sm:p-6">
        <h2 className="text-sm font-semibold">At-a-glance</h2>
        <div className="mt-5 space-y-5">
          <div className="flex items-start gap-3">
            <HardDrive className="mt-0.5 size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <Bar used={node.diskCommittedMb} total={node.diskMb} label="Disk space allocation" />
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MemoryStick className="mt-0.5 size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <Bar used={node.memoryCommittedMb} total={node.memoryMb} label="Memory allocation" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border pt-4 text-sm">
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Server className="size-4" />
              Total servers
            </span>
            <span className="tabular-nums font-medium">{node.serverCount}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Cpu className="size-4" />
              Advertised cores
            </span>
            <span className="tabular-nums font-medium">{node.cpuCores || "—"}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
