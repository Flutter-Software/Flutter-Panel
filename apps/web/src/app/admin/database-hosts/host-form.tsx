"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Database, Plug, Trash2 } from "lucide-react";
import { AdminError } from "@/components/admin-table";
import { AdminCreateHeader, AdminSection, SaveIsland, isDirty } from "@/components/admin-create";
import { confirm } from "@/components/confirm-dialog";
import { Button, Field, Input, SearchSelect } from "@/components/ui";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import type { DatabaseHostRecord } from "./types";

type NodeRow = { id: string; name: string };

export function DatabaseHostForm({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial?: DatabaseHostRecord;
}) {
  const router = useRouter();
  const creating = mode === "create";
  const nodesQuery = useQuery<{ data: { nodes: NodeRow[] } }>("/api/v1/admin/nodes");
  const nodes = nodesQuery.data?.data.nodes ?? [];
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testOk, setTestOk] = useState<string | null>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 3306));
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [publicHost, setPublicHost] = useState(initial?.publicHost ?? "");
  const [publicPort, setPublicPort] = useState(initial?.publicPort ? String(initial.publicPort) : "");
  const [maxDatabases, setMaxDatabases] = useState(String(initial?.maxDatabases ?? 0));
  const [nodeIds, setNodeIds] = useState<string[]>(initial?.nodeIds ?? []);

  const snapshot = {
    name: initial?.name ?? "",
    host: initial?.host ?? "",
    port: String(initial?.port ?? 3306),
    username: initial?.username ?? "",
    password: "",
    publicHost: initial?.publicHost ?? "",
    publicPort: initial?.publicPort ? String(initial.publicPort) : "",
    maxDatabases: String(initial?.maxDatabases ?? 0),
    nodeIds: (initial?.nodeIds ?? []).join(","),
  };
  const dirty = isDirty(
    {
      name,
      host,
      port,
      username,
      password,
      publicHost,
      publicPort,
      maxDatabases,
      nodeIds: nodeIds.join(","),
    },
    snapshot,
  );

  function onCancel() {
    setName(initial?.name ?? "");
    setHost(initial?.host ?? "");
    setPort(String(initial?.port ?? 3306));
    setUsername(initial?.username ?? "");
    setPassword("");
    setPublicHost(initial?.publicHost ?? "");
    setPublicPort(initial?.publicPort ? String(initial.publicPort) : "");
    setMaxDatabases(String(initial?.maxDatabases ?? 0));
    setNodeIds(initial?.nodeIds ?? []);
    setError(null);
    setTestOk(null);
  }

  function body() {
    return {
      name: name.trim(),
      host: host.trim(),
      port: Number(port),
      username: username.trim(),
      password,
      publicHost: publicHost.trim(),
      publicPort: publicPort.trim() ? Number(publicPort) : creating ? undefined : 0,
      maxDatabases: Number(maxDatabases) || 0,
      nodeIds,
    };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (creating) {
        await api("/api/v1/admin/database-hosts", {
          method: "POST",
          body: JSON.stringify(body()),
        });
      } else if (initial) {
        const payload = body();
        await api(`/api/v1/admin/database-hosts/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...payload, password: password || "" }),
        });
      }
      router.push("/admin/database-hosts");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : creating ? "Create failed" : "Save failed");
      setPending(false);
    }
  }

  async function onTest() {
    setError(null);
    setTestOk(null);
    setTesting(true);
    try {
      const result = await api<{ data: { ok: boolean; version?: string } }>(
        "/api/v1/admin/database-hosts/test",
        {
          method: "POST",
          body: JSON.stringify({
            hostId: initial?.id,
            host: host.trim(),
            port: Number(port),
            username: username.trim(),
            password,
          }),
        },
      );
      setTestOk(result.data.version ? `Connected · MySQL ${result.data.version}` : "Connected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setTesting(false);
    }
  }

  async function onDelete() {
    if (!initial) return;
    if (
      !(await confirm({
        title: "Delete database host",
        description: `Delete ${initial.name}? Databases on this host must be removed first.`,
        confirmLabel: "Delete",
      }))
    ) {
      return;
    }
    setError(null);
    setDeleting(true);
    try {
      await api(`/api/v1/admin/database-hosts/${initial.id}`, { method: "DELETE" });
      router.push("/admin/database-hosts");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-6">
      <AdminCreateHeader
        backHref="/admin/database-hosts"
        backLabel="Back to database hosts"
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/database-hosts", label: "Databases" },
          { label: creating ? "New" : initial?.name ?? "Edit" },
        ]}
        icon={<Database className="size-4" />}
        title={creating ? "New database host" : `Edit ${initial?.name ?? "host"}`}
        description="The panel logs in as this user to create MySQL databases for game servers."
      />
      <AdminError message={error} />

      <AdminSection
        icon={<Database className="size-4" />}
        title="Connection"
        description="Use an account that can CREATE DATABASE and CREATE USER."
      >
        <Field label="Name" required hint="Shown to users when they pick a host.">
          <Input value={name} onChange={(event) => setName(event.target.value)} required maxLength={64} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <Field label="Host" required>
            <Input
              value={host}
              onChange={(event) => setHost(event.target.value)}
              required
              className="font-mono"
              placeholder="127.0.0.1"
            />
          </Field>
          <Field label="Port" required>
            <Input type="number" min={1} max={65535} required value={port} onChange={(event) => setPort(event.target.value)} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Username" required>
            <Input value={username} onChange={(event) => setUsername(event.target.value)} required className="font-mono" />
          </Field>
          <Field
            label="Password"
            required={creating}
            hint={creating ? undefined : "Leave blank to keep the current password."}
          >
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required={creating}
              autoComplete="new-password"
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={testing || !host.trim() || !username.trim() || (creating && !password)}
            onClick={() => void onTest()}
          >
            {testing ? "Testing…" : "Test connection"}
          </Button>
          {testOk ? <p className="text-sm text-status-running">{testOk}</p> : null}
        </div>
      </AdminSection>

      <AdminSection
        icon={<Plug className="size-4" />}
        title="What users connect to"
        description="Leave public host blank to show the same hostname the panel uses."
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <Field label="Public host" hint="FQDN or IP players' plugins should use.">
            <Input
              value={publicHost}
              onChange={(event) => setPublicHost(event.target.value)}
              className="font-mono"
              placeholder={host || "Same as host"}
            />
          </Field>
          <Field label="Public port">
            <Input
              type="number"
              min={1}
              max={65535}
              value={publicPort}
              onChange={(event) => setPublicPort(event.target.value)}
              placeholder={port || "3306"}
            />
          </Field>
        </div>
        <Field
          label="Max databases"
          hint="0 means no extra cap beyond each server's own slot limit."
        >
          <Input
            type="number"
            min={0}
            max={10000}
            value={maxDatabases}
            onChange={(event) => setMaxDatabases(event.target.value)}
          />
        </Field>
        <Field
          label="Nodes"
          hint="Empty means every node can use this host. Restrict it if the database is only reachable from some machines."
        >
          <SearchSelect
            multiple
            placeholder="All nodes"
            value={nodeIds}
            onChange={(next) => setNodeIds(Array.isArray(next) ? next : [])}
            options={nodes.map((node) => ({ value: node.id, label: node.name }))}
          />
        </Field>
      </AdminSection>

      {creating ? null : (
        <AdminSection
          icon={<Trash2 className="size-4" />}
          title="Danger zone"
          description="Hosts that still have databases cannot be deleted."
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {initial?.databaseCount
                ? `${initial.databaseCount} database${initial.databaseCount === 1 ? "" : "s"} still use this host.`
                : "This host has no databases."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="danger"
                disabled={deleting || Boolean(initial?.databaseCount)}
                onClick={() => void onDelete()}
              >
                {deleting ? "Deleting…" : "Delete host"}
              </Button>
            </div>
          </div>
        </AdminSection>
      )}

      <SaveIsland
        visible={dirty || pending}
        onCancel={onCancel}
        submitLabel={creating ? "Create host" : "Save changes"}
        pendingLabel={creating ? "Creating…" : "Saving…"}
        pending={pending}
        disabled={!name.trim() || !host.trim() || !username.trim() || (creating && !password)}
        summary={
          <span className="inline-flex items-center gap-2">
            <Database className="size-4 text-primary" />
            {creating ? "Creating" : "Saving"}{" "}
            <span className="font-medium text-foreground">{name.trim() || "host"}</span>
          </span>
        }
      />
    </form>
  );
}
