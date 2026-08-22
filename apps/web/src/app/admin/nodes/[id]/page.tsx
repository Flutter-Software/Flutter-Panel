"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PANEL_VERSION } from "@flutter-software/shared";
import { Cpu, HardDrive, MemoryStick, Server, Trash2 } from "lucide-react";
import { AdminError } from "@/components/admin-table";
import { useAdminNode } from "@/components/node-frame";
import { Button, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { formatGiB } from "@/lib/types";

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
    if (!window.confirm(`Delete node ${nodeName}? This cannot be undone.`)) return;
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
