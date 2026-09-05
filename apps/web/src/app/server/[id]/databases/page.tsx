"use client";

import { use, useCallback, useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, Plus, RefreshCw, Trash2 } from "lucide-react";
import { confirm } from "@/components/confirm-dialog";
import { Button, Card, EmptyState, Field, Input, Modal, Select } from "@/components/ui";
import { toast } from "@/components/toast";
import { useServerRecord } from "@/components/server-frame";
import { api } from "@/lib/api";
import { can } from "@/lib/access";

type HostOption = { id: string; name: string; endpoint: { host: string; port: number }; available?: boolean };

type ServerDb = {
  id: string;
  hostId: string;
  hostName: string;
  name: string;
  database: string;
  username: string;
  password: string;
  remote: string;
  host: string;
  port: number;
  jdbc: string;
  createdAt: string;
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="no-press inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
      disabled={!value}
      aria-label={`Copy ${label}`}
      title={copied ? "Copied" : `Copy ${label}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          },
          () => undefined,
        );
      }}
    >
      {copied ? <Check className="size-3 text-status-running" /> : <Copy className="size-3" />}
    </button>
  );
}

export default function DatabasesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const server = useServerRecord();
  const limit = server?.databaseLimit ?? 0;
  const [rows, setRows] = useState<ServerDb[]>([]);
  const [hosts, setHosts] = useState<HostOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [hostId, setHostId] = useState("");
  const [remote, setRemote] = useState("%");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const canRead = can(server, "database.read");
  const canCreate = can(server, "database.create");
  const canUpdate = can(server, "database.update");
  const canDelete = can(server, "database.delete");

  const load = useCallback(() => {
    return api<{ data: { databases: ServerDb[]; hosts: HostOption[]; limit: number } }>(
      `/api/v1/client/servers/${id}/databases`,
    )
      .then((result) => {
        setRows(result.data.databases ?? []);
        setHosts(result.data.hosts ?? []);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [id]);

  useEffect(() => {
    if (limit <= 0 || !canRead) return;
    void load();
  }, [limit, canRead, load]);

  useEffect(() => {
    if (!open) return;
    if (!hostId && hosts[0]) setHostId(hosts[0].id);
  }, [open, hosts, hostId]);

  if (!server) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Databases</h2>
          <p className="text-sm text-muted-foreground">Loading this server…</p>
        </div>
      </div>
    );
  }

  if (limit <= 0) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Databases</h2>
          <p className="text-sm text-muted-foreground">
            This server has no database slots. An administrator can raise the database limit on the server.
          </p>
        </div>
      </div>
    );
  }

  if (!canRead) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Databases</h2>
          <p className="text-sm text-muted-foreground">You do not have permission to view databases on this server.</p>
        </div>
      </div>
    );
  }

  async function onCreate() {
    setPending(true);
    setError(null);
    try {
      await api(`/api/v1/client/servers/${id}/databases`, {
        method: "POST",
        body: JSON.stringify({ hostId, name: name.trim(), remote: remote.trim() || "%" }),
      });
      setOpen(false);
      setName("");
      setRemote("%");
      toast("Database created", "info");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create database");
    } finally {
      setPending(false);
    }
  }

  async function onRotate(row: ServerDb) {
    if (
      !(await confirm({
        title: "Rotate password",
        description: `Generate a new password for ${row.database}? The old password stops working immediately.`,
        confirmLabel: "Rotate",
      }))
    ) {
      return;
    }
    setPending(true);
    try {
      await api(`/api/v1/client/servers/${id}/databases/${row.id}/rotate`, { method: "POST" });
      toast("Password rotated", "info");
      await load();
      setRevealed((current) => ({ ...current, [row.id]: true }));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Rotate failed");
    } finally {
      setPending(false);
    }
  }

  async function onDelete(row: ServerDb) {
    if (
      !(await confirm({
        title: "Delete database",
        description: `Drop ${row.database} and its user on the host? This cannot be undone.`,
        confirmLabel: "Delete",
      }))
    ) {
      return;
    }
    setPending(true);
    try {
      await api(`/api/v1/client/servers/${id}/databases/${row.id}`, { method: "DELETE" });
      toast("Database deleted", "info");
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Databases</h2>
          <p className="text-sm text-muted-foreground">
            {rows.length}/{limit} slot{limit === 1 ? "" : "s"} used. Connection details are for plugins and apps on this server.
          </p>
        </div>
        {canCreate ? (
          <Button type="button" disabled={pending || rows.length >= limit || hosts.length === 0} onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            New database
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {hosts.length === 0 && rows.length === 0 ? (
        <EmptyState
          title="No database hosts"
          description="An administrator needs to add a MySQL host under Admin → Databases before you can create one here."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No databases yet"
          description="Create a database to get a MySQL username, password, and database name for this server."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const show = revealed[row.id];
            return (
              <Card key={row.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{row.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{row.hostName}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canUpdate ? (
                      <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => void onRotate(row)}>
                        <RefreshCw className="size-3.5" />
                        Rotate password
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        className="text-destructive"
                        onClick={() => void onDelete(row)}
                      >
                        <Trash2 className="size-3.5" />
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </div>
                <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                      Host
                      <CopyButton value={`${row.host}:${row.port}`} label="host" />
                    </dt>
                    <dd className="mt-0.5 font-mono text-sm">
                      {row.host}:{row.port}
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                      Database
                      <CopyButton value={row.database} label="database" />
                    </dt>
                    <dd className="mt-0.5 font-mono text-sm">{row.database}</dd>
                  </div>
                  <div>
                    <dt className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                      Username
                      <CopyButton value={row.username} label="username" />
                    </dt>
                    <dd className="mt-0.5 font-mono text-sm">{row.username}</dd>
                  </div>
                  <div>
                    <dt className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                      Password
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          className="no-press text-muted-foreground hover:text-foreground"
                          aria-label={show ? "Hide password" : "Show password"}
                          onClick={() => setRevealed((current) => ({ ...current, [row.id]: !show }))}
                        >
                          {show ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                        </button>
                        <CopyButton value={row.password} label="password" />
                      </span>
                    </dt>
                    <dd className="mt-0.5 font-mono text-sm">{show ? row.password : "••••••••••••"}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                      Connections from
                    </dt>
                    <dd className="mt-0.5 font-mono text-sm">{row.remote}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                      JDBC
                      <CopyButton value={row.jdbc} label="JDBC URL" />
                    </dt>
                    <dd className="mt-0.5 break-all font-mono text-sm">{row.jdbc}</dd>
                  </div>
                </dl>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        title="New database"
        description="The panel creates a MySQL database and user on the selected host."
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        footer={
          <>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={pending || !name.trim() || !hostId} onClick={() => void onCreate()}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Host" required>
            <Select value={hostId} onChange={(event) => setHostId(event.target.value)} required>
              <option value="">Select a host</option>
              {hosts.map((host) => (
                <option key={host.id} value={host.id}>
                  {host.name} ({host.endpoint.host}:{host.endpoint.port})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name" required hint="Letters, numbers, and underscores. Prefixed with the server id on the host.">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
              maxLength={48}
              required
              className="font-mono"
              placeholder="plugins"
            />
          </Field>
          <Field label="Allow connections from" hint="% allows any address. Use a Docker or node IP to lock it down.">
            <Input value={remote} onChange={(event) => setRemote(event.target.value)} className="font-mono" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
