"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { Globe, HardDrive, Layers, MemoryStick, Network, Plug } from "lucide-react";
import { parsePortSpec } from "@flutter-software/shared";
import { AdminError } from "@/components/admin-table";
import {
  AdminCreateFooter,
  AdminCreateHeader,
  AdminSection,
} from "@/components/admin-create";
import { Card, Field, Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { formatGiB } from "@/lib/types";

type Allocation = { id: string; ip: string; port: number; assigned: boolean };
type Node = {
  id: string;
  name: string;
  fqdn: string;
  memoryMb: number;
  diskMb: number;
  allocations: Allocation[];
};

export default function CreateAllocationsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const backHref = `/admin/nodes/${params.id}/allocations`;
  const { data, error } = useQuery<{ data: { nodes: Node[] } }>("/api/v1/admin/nodes");
  const node = data?.data.nodes.find((row) => row.id === params.id) ?? null;
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ip, setIp] = useState("0.0.0.0");
  const [alias, setAlias] = useState("");
  const [ports, setPorts] = useState("");
  const [notes, setNotes] = useState("");

  const preview = useMemo(() => {
    const parsed = parsePortSpec(ports);
    if (!parsed.ok) return { error: parsed.error, ports: [] as number[], existing: new Set<number>() };
    const existing = new Set(
      (node?.allocations ?? [])
        .filter((row) => row.ip === ip.trim())
        .map((row) => row.port),
    );
    return { error: null as string | null, ports: parsed.ports, existing };
  }, [ports, node, ip]);

  const newCount = preview.ports.filter((port) => !preview.existing.has(port)).length;
  const existingCount = preview.ports.filter((port) => preview.existing.has(port)).length;

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    setPending(true);
    try {
      await api(`/api/v1/admin/nodes/${params.id}/allocations`, {
        method: "POST",
        body: JSON.stringify({ ip, alias, ports, notes }),
      });
      router.push(backHref);
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Allocation create failed");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onCreate} className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-6">
      <AdminCreateHeader
        backHref="/admin/nodes"
        backLabel="Back to nodes"
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/nodes", label: "Nodes" },
          { href: backHref, label: node?.name ?? "Node" },
          { label: "Allocations" },
        ]}
        icon={<Network className="size-4" />}
        title="New allocation"
        description="Expose IP and port bindings on this node so servers have somewhere to listen."
      />
      <AdminError message={actionError ?? error} />

      <div className="grid items-start gap-4 xl:grid-cols-[1.4fr_1fr]">
        <AdminSection
          icon={<Globe className="size-4" />}
          title="Binding details"
          description="The IP the daemon binds to and the ports servers can claim."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="IP address" required hint="The address the daemon listens on.">
              <Input
                value={ip}
                onChange={(event) => setIp(event.target.value)}
                placeholder="0.0.0.0"
                required
                className="font-mono"
              />
            </Field>
            <Field label="IP alias" hint="Optional: friendly hostname shown to users.">
              <Input
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
                placeholder="play.example.com"
                className="font-mono"
              />
            </Field>
          </div>
          <Field
            label="Ports"
            required
            hint="Single ports and ranges, comma-separated — e.g. 25565, 25570-25575."
          >
            <Textarea
              value={ports}
              onChange={(event) => setPorts(event.target.value)}
              placeholder="25565, 25570-25575"
              className="min-h-[88px] font-mono"
              required
            />
          </Field>
          {preview.ports.length ? (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-3">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{newCount} new ports</span>
                {existingCount ? ` · ${existingCount} already exist` : null}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {preview.ports.map((port) => {
                  const exists = preview.existing.has(port);
                  return (
                    <span
                      key={port}
                      className={cn(
                        "rounded-md border px-2 py-0.5 font-mono text-xs",
                        exists
                          ? "border-border text-muted-foreground"
                          : "border-primary/40 text-primary",
                      )}
                    >
                      {port}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : ports.trim() && preview.error ? (
            <p className="text-xs text-status-error">{preview.error}</p>
          ) : null}
          <Field label="Notes" hint="Optional. Applied to every port in this batch.">
            <Input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Java survival pool"
            />
          </Field>
        </AdminSection>

        <AdminSection
          icon={<Layers className="size-4" />}
          title="Target node"
          description="Where these allocations will live."
        >
          {node ? (
            <>
              <div>
                <p className="text-xl font-semibold">{node.name}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{node.fqdn}</p>
              </div>
              <div className="space-y-3 border-t border-border pt-4 text-sm">
                <MetaRow icon={<MemoryStick className="size-4" />} label="Memory" value={formatGiB(node.memoryMb)} />
                <MetaRow icon={<HardDrive className="size-4" />} label="Disk" value={formatGiB(node.diskMb)} />
                <MetaRow
                  icon={<Network className="size-4" />}
                  label="Existing allocations"
                  value={String(node.allocations.length)}
                />
              </div>
            </>
          ) : (
            <div className="h-24 animate-pulse rounded-lg bg-muted/40" />
          )}
        </AdminSection>
      </div>

      <AdminCreateFooter
        cancelHref={backHref}
        submitLabel="Add allocations"
        pendingLabel="Adding…"
        pending={pending}
        disabled={!ip.trim() || newCount === 0}
        summary={
          <span className="inline-flex items-center gap-2">
            <Plug className="size-4 text-primary" />
            <span>
              Adding{" "}
              <span className="font-medium text-foreground">{newCount || 0} ports</span> on{" "}
              <span className="font-mono text-foreground">{ip || "IP"}</span> to{" "}
              <span className="font-medium text-foreground">{node?.name ?? "node"}</span>.
            </span>
          </span>
        }
      />
    </form>
  );
}

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="inline-flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
