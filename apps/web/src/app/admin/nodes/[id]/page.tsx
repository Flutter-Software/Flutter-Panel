"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { AdminError, ListSkeleton } from "@/components/admin-table";
import { Button, ButtonLink, Card, Field, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";

type Allocation = { id: string; ip: string; port: number; assigned: boolean };
type Node = {
  id: string;
  name: string;
  fqdn: string;
  memoryMb: number;
  diskMb: number;
  cpuCores: number;
  online: boolean;
  location: string;
  allocations: Allocation[];
};

function mbToGiB(mb: number) {
  const gib = mb / 1024;
  return Number.isInteger(gib) ? String(gib) : String(Math.round(gib * 10) / 10);
}

export default function NodeDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, error, reload } = useQuery<{ data: { nodes: Node[] } }>("/api/v1/admin/nodes");
  const node = data?.data.nodes.find((row) => row.id === params.id) ?? null;

  const [memoryGiB, setMemoryGiB] = useState("");
  const [diskGiB, setDiskGiB] = useState("");
  const [cpuCores, setCpuCores] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    if (!node) return;
    setMemoryGiB(mbToGiB(node.memoryMb));
    setDiskGiB(mbToGiB(node.diskMb));
    setCpuCores(node.cpuCores > 0 ? String(node.cpuCores) : "");
  }, [node?.id, node?.memoryMb, node?.diskMb, node?.cpuCores]);

  const allocations = node?.allocations ?? [];
  const usedCount = allocations.filter((row) => row.assigned).length;

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!node) return;
    setSaveError(null);
    setPending(true);
    try {
      await api(`/api/v1/admin/nodes/${node.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          memoryMb: Math.round(Number(memoryGiB) * 1024),
          diskMb: Math.round(Number(diskGiB) * 1024),
          cpuCores: Number(cpuCores),
        }),
      });
      await reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  async function onRemoveAllocation(row: Allocation) {
    if (!node) return;
    if (row.assigned) return;
    if (!window.confirm(`Remove allocation ${row.ip}:${row.port}?`)) return;
    setSaveError(null);
    setRemovingId(row.id);
    try {
      await api(`/api/v1/admin/nodes/${node.id}/allocations/${row.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not remove allocation");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <Link
          href="/admin/nodes"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Nodes
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{node?.name ?? "Node"}</h1>
        <p className="mt-1 font-mono text-sm text-muted-foreground">{node?.fqdn ?? "\u00a0"}</p>
        {node ? <p className="mt-1 font-mono text-xs text-muted-foreground">id {node.id}</p> : null}
      </div>

      <AdminError message={saveError ?? error} />

      {node ? (
        <>
          <form onSubmit={onSave}>
            <Card className="p-5 sm:p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Resources</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Limits advertised for this machine. {node.location ? `${node.location} · ` : ""}
                    {node.online ? "Online" : "Offline"}
                  </p>
                </div>
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? "Saving…" : "Save"}
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Memory" required>
                  <div className="relative">
                    <Input
                      type="number"
                      min={1}
                      step="0.5"
                      required
                      className="pr-12"
                      value={memoryGiB}
                      onChange={(event) => setMemoryGiB(event.target.value)}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      GiB
                    </span>
                  </div>
                </Field>
                <Field label="CPU cores" required>
                  <div className="relative">
                    <Input
                      type="number"
                      min={1}
                      max={256}
                      required
                      className="pr-14"
                      value={cpuCores}
                      onChange={(event) => setCpuCores(event.target.value)}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      cores
                    </span>
                  </div>
                </Field>
                <Field label="Disk" required>
                  <div className="relative">
                    <Input
                      type="number"
                      min={1}
                      step="0.5"
                      required
                      className="pr-12"
                      value={diskGiB}
                      onChange={(event) => setDiskGiB(event.target.value)}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      GiB
                    </span>
                  </div>
                </Field>
              </div>
            </Card>
          </form>

          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">
              Allocations
              <span className="ml-2 font-normal text-muted-foreground">
                {usedCount} used / {allocations.length} total
              </span>
            </h2>
            <ButtonLink href={`/admin/nodes/${node.id}/allocations/new`} size="sm">
              <Plus className="size-3.5" />
              Add allocations
            </ButtonLink>
          </div>

          {allocations.length ? (
            <div className="flex flex-wrap gap-2">
              {allocations.map((row) => (
                <span
                  key={row.id}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-xs",
                    row.assigned ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                  )}
                >
                  {row.ip}:{row.port}
                  {row.assigned ? (
                    <span className="font-sans text-[10px] font-semibold uppercase tracking-wide">
                      used
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-destructive"
                      aria-label={`Remove ${row.ip}:${row.port}`}
                      disabled={removingId === row.id}
                      onClick={() => onRemoveAllocation(row)}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          ) : (
            <Card className="px-4 py-10 text-center text-sm text-muted-foreground">
              No allocations yet. Add an IP and port range to place servers on this node.
            </Card>
          )}
        </>
      ) : data && !error ? (
        <AdminError message="Node not found" />
      ) : !error ? (
        <ListSkeleton rows={2} />
      ) : null}
    </div>
  );
}
