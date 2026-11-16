"use client";

import { use, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Globe, HardDrive, Layers, MemoryStick, Network, Plug } from "lucide-react";
import { parsePortSpec } from "@flutter-software/shared";
import { AdminError } from "@/components/admin-table";
import { AdminSection, SaveIsland, isDirty } from "@/components/admin-create";
import { Field, Input, Textarea } from "@/components/ui";
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

export default function CreateAllocationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const backHref = `/admin/nodes/${id}/allocations`;
  const { data, error } = useQuery<{ data: { nodes: Node[] } }>("/api/v1/admin/nodes");
  const node = data?.data.nodes.find((row) => row.id === id) ?? null;
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ip, setIp] = useState("0.0.0.0");
  const [alias, setAlias] = useState("");
  const [ports, setPorts] = useState("");
  const [notes, setNotes] = useState("");
  const dirty = isDirty(
    { ip, alias, ports, notes },
    { ip: "0.0.0.0", alias: "", ports: "", notes: "" },
  );

  function onCancel() {
    setIp("0.0.0.0");
    setAlias("");
    setPorts("");
    setNotes("");
    setActionError(null);
  }

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
      await api(`/api/v1/admin/nodes/${id}/allocations`, {
        method: "POST",
        body: JSON.stringify({ ip, alias, ports, notes }),
      });
      router.push(backHref);
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't add the allocations. Check the IP and port list, then try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onCreate} className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-6">
      {/* This page sits inside the node frame, which already shows the node name, back link and tabs. */}
      <div>
        <h2 className="text-[20px] font-semibold">Add allocations</h2>
        <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
          Open IP and port bindings on {node?.name ?? "this node"} so servers have somewhere to listen.
        </p>
      </div>
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
            <Field label="IP alias" hint="Optional. A friendly hostname shown to users instead of the IP.">
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
            hint="Single ports and ranges separated by commas, for example 25565, 25570-25575."
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
            <div className="border-t border-border pt-3">
              <p className="text-[13px] text-muted-foreground">
                <span className="font-medium tabular-nums text-foreground">
                  {newCount} new {newCount === 1 ? "port" : "ports"}
                </span>
                {existingCount ? (
                  <>
                    , <span className="tabular-nums">{existingCount}</span> already{" "}
                    {existingCount === 1 ? "exists" : "exist"} and will be skipped
                  </>
                ) : null}
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                {preview.ports.map((port) => {
                  const exists = preview.existing.has(port);
                  return (
                    <li
                      key={port}
                      className={cn(
                        "font-mono text-[12.5px] tabular-nums",
                        exists ? "text-muted-foreground line-through" : "text-foreground",
                      )}
                    >
                      {port}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : ports.trim() && preview.error ? (
            <p className="text-[13px] text-status-error">{preview.error}</p>
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
                <p className="font-display text-[18px] font-semibold leading-tight">{node.name}</p>
                <p className="mt-0.5 font-mono text-[12.5px] text-muted-foreground">{node.fqdn}</p>
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
            <div className="h-24 animate-pulse rounded-md bg-muted/40" />
          )}
        </AdminSection>
      </div>

      <SaveIsland
        visible={dirty || pending}
        onCancel={onCancel}
        submitLabel="Add allocations"
        pendingLabel="Adding…"
        pending={pending}
        disabled={!ip.trim() || newCount === 0}
        summary={
          <span className="inline-flex items-center gap-2">
            <Plug className="size-4 text-primary" aria-hidden />
            <span>
              Adding{" "}
              <span className="font-medium tabular-nums text-foreground">
                {newCount || 0} {newCount === 1 ? "port" : "ports"}
              </span>{" "}
              on{" "}
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
