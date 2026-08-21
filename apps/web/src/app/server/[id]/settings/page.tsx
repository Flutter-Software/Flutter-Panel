"use client";

import { use, useEffect, useState, type FormEvent } from "react";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { useServerRecord } from "@/components/server-frame";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import type { ServerRecord } from "@/lib/types";
import { can } from "@/lib/access";

export default function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const framed = useServerRecord();
  const { data, error: loadError, reload } = useQuery<{ data: { server: ServerRecord } }>(
    `/api/v1/client/servers/${id}`,
  );
  const server = data?.data.server ?? framed;
  const [name, setName] = useState(server?.name ?? "");
  const [description, setDescription] = useState(server?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reinstalling, setReinstalling] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!server) return;
    setName(server.name);
    setDescription(server.description);
  }, [id, server?.uuid]);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setPending(true);
    try {
      const result = await api<{ data: { server: ServerRecord } }>(`/api/v1/client/servers/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), description }),
      });
      await reload();
      setName(result.data.server.name);
      setDescription(result.data.server.description);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  async function onReinstall() {
    if (!window.confirm("Reinstall this server? Files in /home/container are kept; the install script runs again.")) {
      return;
    }
    setError(null);
    setReinstalling(true);
    try {
      await api<{ data: { server: ServerRecord } }>(`/api/v1/client/servers/${id}/install`, {
        method: "POST",
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reinstall failed");
    } finally {
      setReinstalling(false);
    }
  }

  if (loadError && !server) {
    return <p className="text-sm text-destructive">{loadError}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">Identity, reinstall, and connection details.</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <form onSubmit={onSave} className="space-y-4 rounded-xl border border-border bg-card p-4">
        <Field label="Name" required>
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} required disabled={!can(server, "settings.rename")} />
        </Field>
        <Field label="Description">
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={240}
            className="min-h-[72px]"
            disabled={!can(server, "settings.rename")}
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending || !name.trim() || !can(server, "settings.rename")}>
            {pending ? "Saving…" : "Save"}
          </Button>
          {saved ? <p className="text-sm text-status-running">Saved</p> : null}
        </div>
      </form>

      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold">Connection</p>
        <Field label="UUID">
          <Input value={server?.uuid ?? ""} readOnly className="font-mono" />
        </Field>
        <Field label="SFTP" hint="SFTP daemon is not enabled yet. This is the node address it will use.">
          <Input
            value={server ? `${server.sftpHost}:${server.sftpPort}` : ""}
            readOnly
            className="font-mono"
          />
        </Field>
        <Field label="Primary allocation">
          <Input value={server?.allocation ?? ""} readOnly className="font-mono" />
        </Field>
      </div>

      {can(server, "settings.reinstall") ? (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div>
          <p className="text-sm font-semibold">Reinstall</p>
          <p className="text-sm text-muted-foreground">
            Runs the egg install script again on this node. Existing files are not wiped.
          </p>
        </div>
        <Button
          type="button"
          variant="danger"
          disabled={reinstalling || server?.status === "installing"}
          onClick={() => void onReinstall()}
        >
          {reinstalling || server?.status === "installing" ? "Installing…" : "Reinstall"}
        </Button>
      </div>
      ) : null}
    </div>
  );
}
