"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PANEL_VERSION } from "@flutter-software/shared";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { AdminError } from "@/components/admin-table";
import { useAdminNode } from "@/components/node-frame";
import { confirm } from "@/components/confirm-dialog";
import { Button, Card, Readout, ReadoutCell } from "@/components/ui";
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

const CHECK_STATE: Record<CheckState, { word: string; text: string; dot: string }> = {
  ok: { word: "Passing", text: "text-status-running", dot: "bg-status-running" },
  bad: { word: "Failing", text: "text-status-error", dot: "bg-status-error" },
  wait: { word: "Checking", text: "text-muted-foreground", dot: "bg-status-offline" },
  skip: { word: "Skipped", text: "text-muted-foreground", dot: "bg-status-offline" },
};

function CheckRow({
  label,
  state,
  detail,
}: {
  label: string;
  state: CheckState;
  detail: string;
}) {
  const meta = CHECK_STATE[state];
  return (
    <li className="flex items-start justify-between gap-4 py-2.5 text-sm first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="font-medium">{label}</p>
        <p className="mt-0.5 break-words text-[13px] text-muted-foreground">{detail}</p>
      </div>
      <span className={cn("mt-0.5 inline-flex shrink-0 items-center gap-2 text-[13px] font-medium", meta.text)}>
        {state === "wait" ? (
          <Loader2 aria-hidden className="size-3 animate-spin" />
        ) : (
          <span aria-hidden className={cn("size-2 rounded-full", meta.dot)} />
        )}
        {meta.word}
      </span>
    </li>
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
        setBrowser({ ok: false, detail: "The node has no public daemon address to test. Set its FQDN in Settings." });
        return;
      }
      if (typeof window !== "undefined" && window.location.protocol === "https:" && url.startsWith("http:")) {
        setBrowser({ ok: false, detail: `Blocked: this page uses HTTPS but the daemon is at ${url}. Serve the daemon over HTTPS.` });
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
      setError(err instanceof Error ? err.message : "Couldn't run the health check. Check that the panel API is reachable, then try again.");
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
    <section aria-labelledby="node-health" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="node-health" className="text-[20px] font-semibold">
          Health
        </h2>
        <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Check again
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Card variant="well" className="px-4 py-3">
        <ul className="divide-y divide-border">
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
            label="Panel reaches daemon"
            state={loading && !health ? "wait" : panel?.ok ? "ok" : "bad"}
            detail={
              panel?.ok
                ? panel.docker && !panel.docker.ok
                  ? `Reached ${panel.url}, but Docker is ${panel.docker.error || "not connected"}`
                  : `Reached ${panel.url}`
                : panel?.error || "Checking…"
            }
          />
          <CheckRow
            label="This browser reaches daemon"
            state={!browser ? "wait" : browser.ok ? "ok" : "bad"}
            detail={browser?.detail || "Checking…"}
          />
          <CheckRow
            label="Daemon config"
            state={loading && !health ? "wait" : configOk ? "ok" : config?.readable ? "bad" : "skip"}
            detail={
              configOk
                ? `Listening on port ${config?.listenPort}, SFTP on port ${config?.sftpPort}`
                : config?.issues[0] || "Not read yet"
            }
          />
        </ul>
      </Card>
      {health ? (
        <p className="text-[13px] text-muted-foreground">
          Ports on this node: daemon <span className="tabular-nums">{health.ports.daemon}</span>/tcp, SFTP{" "}
          <span className="tabular-nums">{health.ports.sftp}</span>/tcp. You still need to open game allocation ports
          yourself.
        </p>
      ) : null}
      {config?.issues && config.issues.length > 1 ? (
        <ul className="list-disc space-y-1 pl-4 text-[13px] text-muted-foreground">
          {config.issues.slice(1).map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function percent(used: number, total: number) {
  return total > 0 ? Math.min(100, (used / total) * 100) : 0;
}

/** One line of the information list: label left, value right, separated by seams. */
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
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

  const version = node.daemonVersion ? `v${node.daemonVersion.replace(/^v/, "")}` : "Unknown";
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
      setError(err instanceof Error ? err.message : "Couldn't delete the node. Delete its servers first, then try again.");
      setPending(false);
      await reload();
    }
  }

  return (
    <div className="space-y-8">
      <Readout>
        <ReadoutCell
          label="Memory allocated"
          value={formatGiB(node.memoryCommittedMb)}
          detail={`of ${formatGiB(node.memoryMb)}`}
          meter={percent(node.memoryCommittedMb, node.memoryMb)}
        />
        <ReadoutCell
          label="Disk allocated"
          value={formatGiB(node.diskCommittedMb)}
          detail={`of ${formatGiB(node.diskMb)}`}
          meter={percent(node.diskCommittedMb, node.diskMb)}
        />
        <ReadoutCell label="Servers" value={node.serverCount} />
        <ReadoutCell label="Advertised cores" value={node.cpuCores || "–"} />
      </Readout>

      <div className="grid items-start gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <NodeHealthCard nodeId={nodeId} />

        <section aria-labelledby="node-info" className="space-y-3">
          <h2 id="node-info" className="text-[20px] font-semibold">
            System
          </h2>
          <dl className="divide-y divide-border text-sm">
            <InfoRow label="Daemon version">
              <span className="font-mono text-[13px]">{version}</span>{" "}
              <span className="text-muted-foreground">(latest is <span className="font-mono text-[13px]">{latest}</span>)</span>
            </InfoRow>
            <InfoRow label="CPU threads">
              <span className="tabular-nums">{threads || "–"}</span>
            </InfoRow>
            {node.system.hostname ? (
              <InfoRow label="Hostname">
                <span className="break-all font-mono text-[13px]">{node.system.hostname}</span>
              </InfoRow>
            ) : null}
            {node.system.platform ? (
              <InfoRow label="Operating system">
                <span className="font-mono text-[13px]">
                  {node.system.platform}
                  {node.system.release ? ` ${node.system.release}` : ""}
                  {node.system.arch ? ` (${node.system.arch})` : ""}
                </span>
              </InfoRow>
            ) : null}
            {node.system.totalMemoryMb ? (
              <InfoRow label="Host memory">
                <span className="tabular-nums">{formatGiB(node.system.totalMemoryMb)}</span>
              </InfoRow>
            ) : null}
          </dl>
        </section>
      </div>

      <section aria-labelledby="node-delete" className="max-w-[72ch] space-y-3 border-t border-border pt-6">
        <h2 id="node-delete" className="text-[20px] font-semibold">
          Delete node
        </h2>
        <p className="text-sm text-muted-foreground">
          {node.serverCount > 0
            ? `Removes this machine from the panel. Move or delete its ${node.serverCount} server${node.serverCount === 1 ? "" : "s"} first.`
            : "Removes this machine from the panel. This can't be undone."}
        </p>
        <AdminError message={error} />
        <Button
          type="button"
          variant="danger"
          disabled={pending || node.serverCount > 0}
          onClick={() => void onDelete()}
        >
          <Trash2 className="size-4" />
          {pending ? "Deleting…" : "Delete node"}
        </Button>
      </section>
    </div>
  );
}
