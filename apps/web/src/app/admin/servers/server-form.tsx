"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Cpu,
  Gauge,
  GitBranch,
  HardDrive,
  MemoryStick,
  Plus,
  Server,
  SlidersHorizontal,
  Terminal,
  Trash2,
  UserRound,
} from "lucide-react";
import { AdminError } from "@/components/admin-table";
import { AdminCreateHeader, AdminSection, SaveIsland, Switch, isDirty } from "@/components/admin-create";
import { confirm } from "@/components/confirm-dialog";
import { Button, Card, Field, Input, SearchSelect, Select, Textarea } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import type { ServerRecord } from "@/lib/types";
import { cn } from "@/lib/cn";
import { UnlimitedIcon } from "@/components/unlimited";
import type { PublicUser } from "@flutter-software/shared";

type EggVariable = { key: string; default: string; description: string };
type EggOption = {
  id: string;
  name: string;
  dockerImage?: string;
  startup?: string;
  stopCommand?: string;
  variables?: EggVariable[];
};
type Nest = { id: string; name: string; eggs: EggOption[] };
type Node = { id: string; name: string; online: boolean; location?: string };
type Allocation = { id: string; ip: string; port: number; assigned: boolean; serverId?: string | null };

function envFromEgg(egg?: EggOption | null): Record<string, string> {
  return Object.fromEntries(
    (egg?.variables ?? []).filter((variable) => variable.key).map((variable) => [variable.key, variable.default ?? ""]),
  );
}

function Panel({
  icon,
  title,
  aside,
  children,
}: {
  icon: ReactNode;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="flex h-full flex-col p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {icon}
          {title}
        </h2>
        {aside ? <p className="text-xs text-muted-foreground">{aside}</p> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </Card>
  );
}

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
  const [extraAllocationIds, setExtraAllocationIds] = useState<string[]>([]);
  const [initialExtraIds, setInitialExtraIds] = useState<string[]>([]);
  const extrasReady = useRef(false);
  const appliedEggId = useRef("");
  const [memoryMb, setMemoryMb] = useState(String(initial?.memory.limitMb ?? 1024));
  const [diskMb, setDiskMb] = useState(String(initial?.disk.limitMb ?? 4096));
  const [cpuPercent, setCpuPercent] = useState(String(initial?.cpu.limit ?? 100));
  const [cpuPinning, setCpuPinning] = useState(String(initial?.cpuPinning ?? 0));
  const [databaseLimit, setDatabaseLimit] = useState(String(initial?.databaseLimit ?? 0));
  const [backupsEnabled, setBackupsEnabled] = useState(initial?.backupsEnabled !== false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [addingPorts, setAddingPorts] = useState(false);
  const [dockerImage, setDockerImage] = useState("");
  const [startup, setStartup] = useState("");
  const [stopCommand, setStopCommand] = useState("stop");
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const dirty = isDirty(
    {
      name,
      description,
      ownerId: ownerId || (creating ? (user?.id ?? "") : ""),
      eggId,
      nodeId,
      allocationId,
      extraAllocationIds: [...extraAllocationIds].sort(),
      memoryMb,
      diskMb,
      cpuPercent,
      cpuPinning,
      databaseLimit,
      backupsEnabled,
      dockerImage,
      startup,
      stopCommand,
      envValues,
    },
    {
      name: initial?.name ?? "",
      description: initial?.description ?? "",
      ownerId: initial?.ownerId ?? (creating ? (user?.id ?? "") : ""),
      eggId: initial?.eggId ?? "",
      nodeId: initial?.nodeId ?? "",
      allocationId: initial?.allocationId ?? "",
      extraAllocationIds: [...initialExtraIds].sort(),
      memoryMb: String(initial?.memory.limitMb ?? 1024),
      diskMb: String(initial?.disk.limitMb ?? 4096),
      cpuPercent: String(initial?.cpu.limit ?? 100),
      cpuPinning: String(initial?.cpuPinning ?? 0),
      databaseLimit: String(initial?.databaseLimit ?? 0),
      backupsEnabled: initial?.backupsEnabled !== false,
      dockerImage: "",
      startup: "",
      stopCommand: "stop",
      envValues: {},
    },
  );

  const eggs = useMemo(
    () => nests.flatMap((nest) => nest.eggs.map((egg) => ({ ...egg, nest: nest.name }))),
    [nests],
  );
  const selectedEgg = eggs.find((egg) => egg.id === eggId);
  const allocationOptions = allocations.filter(
    (row) => !row.assigned || row.id === initial?.allocationId || row.serverId === initial?.id,
  );

  function onCancel() {
    setName(initial?.name ?? "");
    setDescription(initial?.description ?? "");
    setOwnerId(initial?.ownerId ?? "");
    setEggId(initial?.eggId ?? "");
    setNodeId(initial?.nodeId ?? "");
    setAllocationId(initial?.allocationId ?? "");
    setExtraAllocationIds(initialExtraIds);
    setAddingPorts(false);
    setMemoryMb(String(initial?.memory.limitMb ?? 1024));
    setDiskMb(String(initial?.disk.limitMb ?? 4096));
    setCpuPercent(String(initial?.cpu.limit ?? 100));
    setCpuPinning(String(initial?.cpuPinning ?? 0));
    setDatabaseLimit(String(initial?.databaseLimit ?? 0));
    setBackupsEnabled(initial?.backupsEnabled !== false);
    appliedEggId.current = "";
    setAdvancedOpen(false);
    setDockerImage("");
    setStartup("");
    setStopCommand("stop");
    setEnvValues({});
    setError(null);
  }

  useEffect(() => {
    if (!ownerId && user?.id && creating) setOwnerId(user.id);
  }, [ownerId, user?.id, creating]);

  useEffect(() => {
    if (!nodeId) {
      setAllocations([]);
      return;
    }
    api<{ data: { allocations: Allocation[] } }>(`/api/v1/admin/nodes/${nodeId}/allocations`)
      .then((result) => {
        const rows = result.data.allocations;
        setAllocations(rows);
        if (!extrasReady.current && initial) {
          extrasReady.current = true;
          const extras = rows
            .filter((row) => row.serverId === initial.id && row.id !== initial.allocationId)
            .map((row) => row.id);
          setExtraAllocationIds(extras);
          setInitialExtraIds(extras);
          if (extras.length) setAddingPorts(true);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load allocations"));
  }, [nodeId, initial]);

  useEffect(() => {
    if (!creating) return;
    const egg = eggs.find((item) => item.id === eggId);
    if (!eggId || !egg) {
      if (!appliedEggId.current) return;
      appliedEggId.current = "";
      setAdvancedOpen(false);
      setDockerImage("");
      setStartup("");
      setStopCommand("stop");
      setEnvValues({});
      return;
    }
    if (appliedEggId.current === egg.id) return;
    appliedEggId.current = egg.id;
    setDockerImage(egg.dockerImage ?? "");
    setStartup(egg.startup ?? "");
    setStopCommand(egg.stopCommand || "stop");
    setEnvValues(envFromEgg(egg));
  }, [creating, eggId, eggs]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const body = {
      name: name.trim(),
      description,
      ownerId,
      allocationId,
      allocationIds: extraAllocationIds.filter((id) => id !== allocationId),
      memoryMb: Number(memoryMb),
      diskMb: Number(diskMb),
      cpuPercent: Number(cpuPercent),
      cpuPinning: Number(cpuPinning),
      databaseLimit: Number(databaseLimit),
      backupsEnabled,
      ...(creating
        ? {
            eggId,
            nodeId,
            dockerImage: dockerImage.trim() || undefined,
            startup,
            stopCommand: stopCommand.trim() || undefined,
            environment: Object.fromEntries(
              (selectedEgg?.variables ?? [])
                .filter((variable) => variable.key)
                .map((variable) => [variable.key, envValues[variable.key] ?? variable.default ?? ""]),
            ),
          }
        : {}),
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
    if (
      !(await confirm({
        title: "Delete server",
        description: `Delete ${initial.name}? The container will be destroyed.`,
        confirmLabel: "Delete",
      }))
    ) {
      return;
    }
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
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-6">
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
      />
      <AdminError message={error ?? nestsQuery.error ?? nodesQuery.error ?? usersQuery.error} />

      <div className="grid items-stretch gap-4 xl:grid-cols-3">
        <div className="h-full xl:col-span-2">
          <Panel icon={<Server className="size-3.5" />} title="Server">
            <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Survival"
                required
                maxLength={64}
              />
            </Field>
            <Field label="Owner" required>
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
            <Field label="Egg" required hint={creating ? undefined : "Cannot be changed"}>
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
            <Field label="Description">
              <Textarea
                rows={1}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional"
                maxLength={240}
                className="h-10 min-h-10 resize-y"
              />
            </Field>
            </div>
          </Panel>
        </div>

        <Panel icon={<GitBranch className="size-3.5" />} title="Network">
          <div className="space-y-4">
            <Field label="Node" required hint={creating ? undefined : "Cannot be changed"}>
              {creating ? (
                <Select
                  value={nodeId}
                  onChange={(event) => {
                    setNodeId(event.target.value);
                    setAllocationId("");
                    setExtraAllocationIds([]);
                    setAddingPorts(false);
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
            <Field label="Allocation" required>
              <Select
                value={allocationId}
                onChange={(event) => {
                  const next = event.target.value;
                  setAllocationId(next);
                  setExtraAllocationIds((current) => current.filter((id) => id !== next));
                }}
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
            <Field label="Extra ports">
              {extraAllocationIds.length || addingPorts ? (
                <SearchSelect
                  multiple
                  disabled={!nodeId}
                  className="font-mono"
                  placeholder={nodeId ? "Add another" : "Select a node first"}
                  value={extraAllocationIds}
                  onChange={(next) =>
                    setExtraAllocationIds(Array.isArray(next) ? next.filter((id) => id !== allocationId) : [])
                  }
                  options={allocations
                    .filter(
                      (row) =>
                        row.id !== allocationId &&
                        (!row.assigned || row.serverId === initial?.id),
                    )
                    .map((row) => ({
                      value: row.id,
                      label: `${row.ip}:${row.port}`,
                    }))}
                />
              ) : (
                <button
                  type="button"
                  disabled={!nodeId}
                  onClick={() => setAddingPorts(true)}
                  className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                  <Plus className="size-3.5" />
                  Add another
                </button>
              )}
            </Field>
          </div>
        </Panel>
      </div>

      <Panel icon={<Gauge className="size-3.5" />} title="Limits" aside="0 = unlimited · 100% CPU = 1 core">
        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <Field label="Memory (MB)" required>
            <Input
              type="number"
              min={0}
              required
              value={memoryMb}
              onChange={(event) => setMemoryMb(event.target.value)}
            />
          </Field>
          <Field label="Disk (MB)" required>
            <Input
              type="number"
              min={0}
              required
              value={diskMb}
              onChange={(event) => setDiskMb(event.target.value)}
            />
          </Field>
          <Field label="CPU (%)" required>
            <Input
              type="number"
              min={0}
              max={800}
              required
              value={cpuPercent}
              onChange={(event) => setCpuPercent(event.target.value)}
            />
          </Field>
          <Field label="CPU pinning">
            <Input
              type="number"
              min={0}
              max={256}
              value={cpuPinning}
              onChange={(event) => setCpuPinning(event.target.value)}
            />
          </Field>
          <Field label="Databases">
            <Input
              type="number"
              min={0}
              max={50}
              value={databaseLimit}
              onChange={(event) => setDatabaseLimit(event.target.value)}
            />
          </Field>
          <div className="space-y-1.5">
            <span className="block text-sm">Backups</span>
            <div className="flex h-10 items-center gap-2.5">
              <Switch checked={backupsEnabled} onChange={setBackupsEnabled} />
              <span className="text-sm text-muted-foreground">{backupsEnabled ? "Enabled" : "Disabled"}</span>
            </div>
          </div>
        </div>
      </Panel>

      {creating && selectedEgg ? (
        <Card>
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            className="flex w-full items-center gap-3 px-5 py-4 text-left sm:px-6"
            aria-expanded={advancedOpen}
          >
            <SlidersHorizontal className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Advanced setup
            </span>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {selectedEgg.nest} · {selectedEgg.name}
            </span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                advancedOpen && "rotate-180",
              )}
            />
          </button>
          {advancedOpen ? (
            <div className="grid gap-6 border-t border-border px-5 py-5 sm:px-6 xl:grid-cols-2">
              <div className="space-y-4">
                <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Terminal className="size-3.5" />
                  Startup
                </p>
                <Field label="Docker image">
                  <Input
                    value={dockerImage}
                    onChange={(event) => setDockerImage(event.target.value)}
                    placeholder={selectedEgg.dockerImage || "image:tag"}
                    className="font-mono"
                    maxLength={255}
                  />
                </Field>
                <Field label="Startup command">
                  <Textarea
                    value={startup}
                    onChange={(event) => setStartup(event.target.value)}
                    placeholder={selectedEgg.startup || "Leave blank for the image entrypoint"}
                    className="min-h-[72px] font-mono"
                    maxLength={2000}
                  />
                </Field>
                <Field label="Stop command">
                  <Input
                    value={stopCommand}
                    onChange={(event) => setStopCommand(event.target.value)}
                    placeholder="stop"
                    className="font-mono"
                    maxLength={120}
                  />
                </Field>
              </div>
              <div className="space-y-4">
                <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <SlidersHorizontal className="size-3.5" />
                  Variables
                </p>
                {(selectedEgg.variables ?? []).filter((variable) => variable.key).length === 0 ? (
                  <p className="text-sm text-muted-foreground">This egg has no variables.</p>
                ) : (
                  (selectedEgg.variables ?? [])
                    .filter((variable) => variable.key)
                    .map((variable) => (
                      <Field key={variable.key} label={variable.key} hint={variable.description || undefined}>
                        <Input
                          value={envValues[variable.key] ?? ""}
                          onChange={(event) =>
                            setEnvValues((current) => ({
                              ...current,
                              [variable.key]: event.target.value,
                            }))
                          }
                          className="font-mono"
                          maxLength={512}
                        />
                      </Field>
                    ))
                )}
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {creating ? null : (
        <AdminSection icon={<Trash2 className="size-4" />} title="Danger zone" description="Deletes the container and files.">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">This cannot be undone.</p>
            <Button type="button" variant="danger" disabled={deleting} onClick={onDelete}>
              {deleting ? "Deleting…" : "Delete server"}
            </Button>
          </div>
        </AdminSection>
      )}

      <SaveIsland
        visible={dirty || pending}
        onCancel={onCancel}
        submitLabel={creating ? "Create server" : "Save changes"}
        pendingLabel={creating ? "Creating…" : "Saving…"}
        pending={pending}
        disabled={!ready}
        summary={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <Server className="size-4 text-primary" />
              <span className="font-medium text-foreground">{name || "server"}</span>
            </span>
            <span className="inline-flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1">
                <MemoryStick className="size-3.5" />
                {Number(memoryMb) === 0 ? <UnlimitedIcon className="size-3.5" /> : `${memoryMb} MB`}
              </span>
              <span className="inline-flex items-center gap-1">
                <HardDrive className="size-3.5" />
                {Number(diskMb) === 0 ? <UnlimitedIcon className="size-3.5" /> : `${diskMb} MB`}
              </span>
              <span className="inline-flex items-center gap-1">
                <Cpu className="size-3.5" />
                {Number(cpuPercent) === 0 ? <UnlimitedIcon className="size-3.5" /> : `${cpuPercent}%`}
              </span>
            </span>
            <span className="inline-flex items-center gap-1">
              <UserRound className="size-3.5" />
              {users.find((account) => account.id === ownerId)?.username ?? "owner"}
            </span>
          </span>
        }
      />
    </form>
  );
}
