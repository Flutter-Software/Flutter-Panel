"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Box, Cpu, HardDrive, MemoryStick, Network, Server, Trash2, UserRound } from "lucide-react";
import { AdminError } from "@/components/admin-table";
import { AdminCreateFooter, AdminCreateHeader, AdminSection, Switch } from "@/components/admin-create";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import type { ServerRecord } from "@/lib/types";
import type { PublicUser } from "@flutter-software/shared";

type Nest = { id: string; name: string; eggs: { id: string; name: string }[] };
type Node = { id: string; name: string; online: boolean; location?: string };
type Allocation = { id: string; ip: string; port: number; assigned: boolean };

export function ServerForm({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial?: ServerRecord;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const creating = mode === "create";
  const nestsQuery = useQuery<{ data: { nests: Nest[] } }>("/api/v1/admin/nests");
  const nodesQuery = useQuery<{ data: { nodes: Node[] } }>("/api/v1/admin/nodes");
  const usersQuery = useQuery<{ data: { users: PublicUser[] } }>("/api/v1/admin/users");
  const nests = nestsQuery.data?.data.nests ?? [];
  const nodes = nodesQuery.data?.data.nodes ?? [];
  const users = usersQuery.data?.data.users ?? [];
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [ownerId, setOwnerId] = useState(initial?.ownerId ?? "");
  const [eggId, setEggId] = useState(initial?.eggId ?? "");
  const [nodeId, setNodeId] = useState(initial?.nodeId ?? "");
  const [allocationId, setAllocationId] = useState(initial?.allocationId ?? "");
  const [memoryMb, setMemoryMb] = useState(String(initial?.memory.limitMb ?? 1024));
  const [diskMb, setDiskMb] = useState(String(initial?.disk.limitMb ?? 4096));
  const [cpuPercent, setCpuPercent] = useState(String(initial?.cpu.limit ?? 100));
  const [cpuPinning, setCpuPinning] = useState(String(initial?.cpuPinning ?? 0));
  const [databaseLimit, setDatabaseLimit] = useState(String(initial?.databaseLimit ?? 0));
  const [backupsEnabled, setBackupsEnabled] = useState(initial?.backupsEnabled !== false);

  const eggs = useMemo(
    () => nests.flatMap((nest) => nest.eggs.map((egg) => ({ ...egg, nest: nest.name }))),
    [nests],
  );
  const selectedEgg = eggs.find((egg) => egg.id === eggId);
  const selectedNode = nodes.find((node) => node.id === nodeId);
  const selectedAllocation = allocations.find((row) => row.id === allocationId);
  const allocationOptions = allocations.filter(
    (row) => !row.assigned || row.id === initial?.allocationId,
  );

  useEffect(() => {
    if (!ownerId && user?.id && creating) setOwnerId(user.id);
  }, [ownerId, user?.id, creating]);

  useEffect(() => {
    if (!nodeId) {
      setAllocations([]);
      return;
    }
    api<{ data: { allocations: Allocation[] } }>(`/api/v1/admin/nodes/${nodeId}/allocations`)
      .then((result) => setAllocations(result.data.allocations))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load allocations"));
  }, [nodeId]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const body = {
      name: name.trim(),
      description,
      ownerId,
      allocationId,
      memoryMb: Number(memoryMb),
      diskMb: Number(diskMb),
      cpuPercent: Number(cpuPercent),
      cpuPinning: Number(cpuPinning),
      databaseLimit: Number(databaseLimit),
      backupsEnabled,
      ...(creating ? { eggId, nodeId } : {}),
    };
    try {
      if (creating) {
        await api("/api/v1/admin/servers", {
          method: "POST",
          body: JSON.stringify(body),
        });
      } else if (initial) {
        await api(`/api/v1/admin/servers/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      router.push("/admin/servers");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : creating ? "Create failed" : "Save failed");
      setPending(false);
    }
  }

  async function onDelete() {
    if (!initial) return;
    if (!window.confirm(`Delete server ${initial.name}? The container will be destroyed.`)) return;
    setError(null);
    setDeleting(true);
    try {
      await api(`/api/v1/admin/servers/${initial.id}`, { method: "DELETE" });
      router.push("/admin/servers");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  const ready =
    name.trim() &&
    ownerId &&
    eggId &&
    nodeId &&
    allocationId &&
    Number.isFinite(Number(memoryMb)) &&
    Number(memoryMb) >= 0 &&
    Number.isFinite(Number(diskMb)) &&
    Number(diskMb) >= 0 &&
    Number.isFinite(Number(cpuPercent)) &&
    Number(cpuPercent) >= 0 &&
    Number.isFinite(Number(cpuPinning)) &&
    Number(cpuPinning) >= 0 &&
    Number.isFinite(Number(databaseLimit)) &&
    Number(databaseLimit) >= 0;

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-6">
      <AdminCreateHeader
        backHref="/admin/servers"
        backLabel="Back to servers"
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/servers", label: "Servers" },
          { label: creating ? "New" : initial?.name ?? "Edit" },
        ]}
        icon={<Server className="size-4" />}
        title={creating ? "New server" : `Edit ${initial?.name ?? "server"}`}
        description={
          creating
            ? "Place a game server on a node. Install requires an online daemon."
            : "Update identity, owner, allocation, and resource limits. Egg and node stay with this server."
        }
      />
      <AdminError message={error ?? nestsQuery.error ?? nodesQuery.error ?? usersQuery.error} />

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <AdminSection
          icon={<Box className="size-4" />}
          title="Server details"
          description="What this instance is called and which egg it runs."
        >
          <Field label="Name" required hint="Shown to the owner on the dashboard.">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Survival"
              required
              maxLength={64}
            />
          </Field>
          <Field label="Description" hint="Optional. Keep it short.">
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Paper 1.21 public hub"
              className="min-h-[72px]"
              maxLength={240}
            />
          </Field>
          <Field label="Owner" required hint="This account sees the server on their dashboard.">
            <Select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} required>
              <option value="">Select owner</option>
              {users.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.username}
                  {account.role === "admin" ? " (admin)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Egg"
            required
            hint={creating ? "Defines the Docker image, install script, and startup." : "Egg cannot be changed after create."}
          >
            {creating ? (
              <Select value={eggId} onChange={(event) => setEggId(event.target.value)} required>
                <option value="">Select egg</option>
                {eggs.map((egg) => (
                  <option key={egg.id} value={egg.id}>
                    {egg.nest} / {egg.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Input value={initial?.egg ?? selectedEgg?.name ?? ""} disabled />
            )}
          </Field>
        </AdminSection>

        <AdminSection
          icon={<Network className="size-4" />}
          title="Placement & limits"
          description="Where it listens, how much of the node it may use, and which features are enabled. 0 for memory, disk, or CPU means unlimited."
        >
          <Field
            label="Node"
            required
            hint={creating ? "Must be online for install to succeed." : "Node cannot be changed after create."}
          >
            {creating ? (
              <Select
                value={nodeId}
                onChange={(event) => {
                  setNodeId(event.target.value);
                  setAllocationId("");
                }}
                required
              >
                <option value="">Select node</option>
                {nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                    {node.online ? "" : " (offline)"}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                value={
                  initial?.nodeLocation ? `${initial.node} · ${initial.nodeLocation}` : (initial?.node ?? "")
                }
                disabled
              />
            )}
          </Field>
          <Field label="Allocation" required hint="IP and port the game process binds to.">
            <Select
              value={allocationId}
              onChange={(event) => setAllocationId(event.target.value)}
              required
              disabled={!nodeId}
              className="font-mono"
            >
              <option value="">{nodeId ? "Select allocation" : "Select a node first"}</option>
              {allocationOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.ip}:{row.port}
                  {row.id === initial?.allocationId ? " (current)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Memory (MB)" required hint="0 = unlimited">
              <Input
                type="number"
                min={0}
                required
                value={memoryMb}
                onChange={(event) => setMemoryMb(event.target.value)}
              />
            </Field>
            <Field label="Disk (MB)" required hint="0 = unlimited">
              <Input
                type="number"
                min={0}
                required
                value={diskMb}
                onChange={(event) => setDiskMb(event.target.value)}
              />
            </Field>
            <Field label="CPU (%)" required hint="0 = unlimited. 100 = one core.">
              <Input
                type="number"
                min={0}
                max={800}
                required
                value={cpuPercent}
                onChange={(event) => setCpuPercent(event.target.value)}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="CPU pinning"
              hint="Number of cores to pin. 0 disables pinning and the process may run on any core."
            >
              <Input
                type="number"
                min={0}
                max={256}
                value={cpuPinning}
                onChange={(event) => setCpuPinning(event.target.value)}
              />
            </Field>
            <Field label="Databases" hint="How many databases this server may have. 0 means none.">
              <Input
                type="number"
                min={0}
                max={50}
                value={databaseLimit}
                onChange={(event) => setDatabaseLimit(event.target.value)}
              />
            </Field>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span>
              <span className="block text-sm font-medium">Backups</span>
              <span className="text-xs text-muted-foreground">
                Allow this server to create and restore backups
              </span>
            </span>
            <Switch checked={backupsEnabled} onChange={setBackupsEnabled} />
          </label>
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
            <p className="inline-flex items-center gap-2 font-medium text-foreground">
              <Cpu className="size-4 text-primary" />
              Summary
            </p>
            <p className="mt-1 text-xs">
              {selectedEgg?.name ?? "Egg"} on {selectedNode?.name ?? "node"}
              {selectedAllocation ? (
                <>
                  {" "}
                  at{" "}
                  <span className="font-mono text-foreground">
                    {selectedAllocation.ip}:{selectedAllocation.port}
                  </span>
                </>
              ) : null}
              .
            </p>
          </div>
        </AdminSection>
      </div>

      {creating ? null : (
        <AdminSection
          icon={<Trash2 className="size-4" />}
          title="Danger zone"
          description="Destroy the container and remove this server from the panel."
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Files on the node are deleted. This cannot be undone.
            </p>
            <Button type="button" variant="danger" disabled={deleting} onClick={onDelete}>
              {deleting ? "Deleting…" : "Delete server"}
            </Button>
          </div>
        </AdminSection>
      )}

      <AdminCreateFooter
        cancelHref="/admin/servers"
        submitLabel={creating ? "Create server" : "Save changes"}
        pendingLabel={creating ? "Creating…" : "Saving…"}
        pending={pending}
        disabled={!ready}
        summary={
          <span className="inline-flex items-center gap-2">
            <Server className="size-4 text-primary" />
            {creating ? "Creating" : "Saving"}{" "}
            <span className="font-medium text-foreground">{name || "server"}</span>
            {selectedNode ? (
              <>
                {" "}
                on <span className="font-medium text-foreground">{selectedNode.name}</span>
              </>
            ) : null}
            <span className="hidden items-center gap-1 sm:inline-flex">
              <MemoryStick className="size-3.5" />
              {Number(memoryMb) === 0 ? "∞" : `${memoryMb} MB`}
              <HardDrive className="size-3.5" />
              {Number(diskMb) === 0 ? "∞" : `${diskMb} MB`}
              <Cpu className="size-3.5" />
              {Number(cpuPercent) === 0 ? "∞" : `${cpuPercent}%`}
            </span>
            <span className="hidden items-center gap-1 sm:inline-flex">
              <UserRound className="size-3.5" />
              {users.find((account) => account.id === ownerId)?.username ?? "owner"}
            </span>
          </span>
        }
      />
    </form>
  );
}
