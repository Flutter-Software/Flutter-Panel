"use client";

import { use, useEffect, useState, type FormEvent } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { confirm } from "@/components/confirm-dialog";
import { SaveButton } from "@/components/save-button";
import { Button, buttonClass, Field, Input, Textarea } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import { useServerRecord } from "@/components/server-frame";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import type { ServerRecord } from "@/lib/types";
import { can } from "@/lib/access";

export default function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const framed = useServerRecord();
  const { user } = useAuth();
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

  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!server) return;
    setName(server.name);
    setDescription(server.description);
  }, [id, server?.uuid]);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2200);
    return () => window.clearTimeout(timer);
  }, [saved]);

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
    if (
      !(await confirm({
        title: "Reinstall server",
        description: "Files in /home/container are kept; the install script runs again.",
        confirmLabel: "Reinstall",
      }))
    ) {
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

  const sftpHost = server?.sftpHost ?? "";
  const sftpPort = server?.sftpPort ?? 2022;
  const sftpAddress = sftpHost ? `${sftpHost}:${sftpPort}` : "";
  const sftpUsername = user?.username && server?.uuid ? `${user.username}.${server.uuid}` : "";
  const sftpUrl =
    sftpHost && sftpUsername
      ? `sftp://${encodeURIComponent(sftpUsername)}@${sftpHost}:${sftpPort}`
      : "";
  const canSftp = can(server, "file.read");

  async function copyValue(key: string, value: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1200);
    } catch {
      /* ignore */
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
          <Input
            value={name}
            onChange={(event) => {
              setSaved(false);
              setName(event.target.value);
            }}
            maxLength={64}
            required
            disabled={!can(server, "settings.rename")}
          />
        </Field>
        <Field label="Description">
          <Textarea
            value={description}
            onChange={(event) => {
              setSaved(false);
              setDescription(event.target.value);
            }}
            maxLength={240}
            className="min-h-[72px]"
            disabled={!can(server, "settings.rename")}
          />
        </Field>
        <div className="flex items-center gap-3">
          <SaveButton pending={pending} saved={saved} disabled={!name.trim() || !can(server, "settings.rename")}>
            Save
          </SaveButton>
        </div>
      </form>

      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold">Connection</p>
        <Field label="UUID">
          <Input value={server?.uuid ?? ""} readOnly className="font-mono" />
        </Field>
        <Field
          label="SFTP address"
          extra={
            <CopyFieldButton
              copied={copied === "address"}
              disabled={!sftpAddress}
              onCopy={() => void copyValue("address", sftpAddress)}
            />
          }
          hint="Connect with FileZilla, WinSCP, or Cyberduck. Password is your panel account password."
        >
          <Input value={sftpAddress} readOnly className="font-mono" />
        </Field>
        <Field
          label="SFTP username"
          extra={
            <CopyFieldButton
              copied={copied === "username"}
              disabled={!sftpUsername}
              onCopy={() => void copyValue("username", sftpUsername)}
            />
          }
        >
          <Input value={sftpUsername} readOnly className="font-mono" />
        </Field>
        {canSftp && sftpUrl ? (
          <a href={sftpUrl} className={buttonClass({ variant: "secondary" })}>
            <ExternalLink className="size-4" />
            Launch SFTP
          </a>
        ) : null}
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

function CopyFieldButton({
  copied,
  disabled,
  onCopy,
}: {
  copied: boolean;
  disabled?: boolean;
  onCopy: () => void;
}) {
  return (
    <button
      type="button"
      className="no-press inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.preventDefault();
        onCopy();
      }}
    >
      {copied ? <Check className="size-3 text-status-running" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
