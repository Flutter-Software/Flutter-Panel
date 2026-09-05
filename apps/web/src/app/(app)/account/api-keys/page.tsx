"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
import {
  APPLICATION_SCOPE_GROUPS,
  API_KEY_APPLICATION_PREFIX,
  API_KEY_CLIENT_PREFIX,
  type ApiKeyKind,
  type ApplicationScope,
} from "@flutter-software/shared";
import { confirm } from "@/components/confirm-dialog";
import { useAuth } from "@/components/auth-provider";
import { Button, Card, EmptyState, Field, Input, Modal, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import type { ServerRecord } from "@/lib/types";
import { SettingsSection } from "../settings-nav";

type ApiKeyRow = {
  id: string;
  kind: ApiKeyKind;
  name: string;
  tokenPrefix: string;
  serverIds: string[];
  allServers: boolean;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        });
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function scopeLabel(scopes: string[]) {
  if (scopes.includes("*") || scopes.length === 0) return "Full panel access";
  if (scopes.length <= 2) return scopes.join(", ");
  return `${scopes.length} scopes`;
}

export default function AccountApiKeysPage() {
  const { user } = useAuth();
  const admin = user?.role === "admin";
  const { data, error, reload } = useQuery<{ data: { keys: ApiKeyRow[] } }>("/api/v1/account/api-keys");
  const serversQuery = useQuery<{ data: { servers: ServerRecord[] } }>("/api/v1/client/servers");
  const keys = data?.data.keys ?? [];
  const servers = serversQuery.data?.data.servers ?? [];
  const [creating, setCreating] = useState<ApiKeyKind | null>(null);
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [allServers, setAllServers] = useState(true);
  const [serverIds, setServerIds] = useState<string[]>([]);
  const [fullAccess, setFullAccess] = useState(true);
  const [scopes, setScopes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ name: string; token: string; kind: ApiKeyKind } | null>(null);

  const clientKeys = keys.filter((row) => row.kind === "client");
  const applicationKeys = keys.filter((row) => row.kind === "application");
  const serverNames = useMemo(() => new Map(servers.map((server) => [server.id, server.name])), [servers]);

  function resetForm() {
    setName("");
    setExpiresInDays("");
    setAllServers(true);
    setServerIds([]);
    setFullAccess(true);
    setScopes([]);
    setActionError(null);
  }

  async function createKey() {
    if (!creating) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await api<{ data: { key: ApiKeyRow; token: string } }>("/api/v1/account/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          kind: creating,
          serverIds: creating === "client" && !allServers ? serverIds : undefined,
          scopes: creating === "application" ? (fullAccess ? ["*"] : scopes) : undefined,
          expiresInDays: expiresInDays ? Number(expiresInDays) : null,
        }),
      });
      setCreating(null);
      resetForm();
      setSecret({ name: result.data.key.name, token: result.data.token, kind: creating });
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not create API key");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string, label: string) {
    const ok = await confirm({
      title: "Revoke API key?",
      description: `${label} will stop working immediately.`,
      confirmLabel: "Revoke",
      danger: true,
    });
    if (!ok) return;
    setActionError(null);
    try {
      await api(`/api/v1/account/api-keys/${id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not revoke API key");
    }
  }

  function toggleScope(scope: ApplicationScope, on: boolean) {
    setScopes((current) => (on ? [...new Set([...current, scope])] : current.filter((item) => item !== scope)));
  }

  function KeyList({
    rows,
    empty,
  }: {
    rows: ApiKeyRow[];
    empty: string;
  }) {
    if (!rows.length) {
      return <p className="px-5 py-10 text-center text-sm text-muted-foreground">{empty}</p>;
    }
    return (
      <>
        {rows.map((row) => (
          <div key={row.id} className="flex items-start justify-between gap-4 px-5 py-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{row.name}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {row.tokenPrefix}••••
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {row.kind === "application"
                  ? scopeLabel(row.scopes)
                  : row.allServers
                    ? "All servers you can access"
                    : row.serverIds.map((id) => serverNames.get(id) || id).join(", ") || "No servers"}
                {" · "}
                created {new Date(row.createdAt).toLocaleDateString()}
                {row.lastUsedAt ? ` · last used ${new Date(row.lastUsedAt).toLocaleString()}` : " · never used"}
                {row.expiresAt ? ` · expires ${new Date(row.expiresAt).toLocaleDateString()}` : ""}
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => void revoke(row.id, row.name)}>
              <Trash2 className="size-3.5" />
              Revoke
            </Button>
          </div>
        ))}
      </>
    );
  }

  return (
    <SettingsSection
      title="API keys"
      description="Keys let scripts and billing systems talk to Flutter without signing in to the panel."
    >
      {error || actionError ? <p className="text-sm text-destructive">{actionError ?? error}</p> : null}

      <Card className="overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold">Account keys</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Act as you on <span className="font-mono">/api/v1/client</span>. Header:{" "}
              <span className="font-mono">Authorization: Bearer {API_KEY_CLIENT_PREFIX}…</span>
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              resetForm();
              setCreating("client");
            }}
          >
            <Plus className="size-3.5" />
            Create
          </Button>
        </div>
        <div className="divide-y divide-border">
          <KeyList rows={clientKeys} empty="No account keys yet." />
        </div>
      </Card>

      {admin ? (
        <Card className="overflow-hidden">
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h3 className="text-sm font-semibold">Application keys</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Manage the panel through <span className="font-mono">/api/v1/admin</span>. Header:{" "}
                <span className="font-mono">Authorization: Bearer {API_KEY_APPLICATION_PREFIX}…</span>
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                resetForm();
                setCreating("application");
              }}
            >
              <Plus className="size-3.5" />
              Create
            </Button>
          </div>
          <div className="divide-y divide-border">
            <KeyList rows={applicationKeys} empty="No application keys yet." />
          </div>
        </Card>
      ) : null}

      <Modal
        open={Boolean(creating)}
        onClose={() => {
          if (!busy) setCreating(null);
        }}
        title={creating === "application" ? "New application key" : "New account key"}
        description={
          creating === "application"
            ? "This key can create servers, users, and other admin resources."
            : "This key can control servers you already have access to."
        }
        footer={
          <>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setCreating(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy || !name.trim()} onClick={() => void createKey()}>
              {busy ? "Creating…" : "Create key"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name" required>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Billing, Discord bot…" />
          </Field>
          <Field label="Expires">
            <Select compact value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)}>
              <option value="">Never</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </Select>
          </Field>
          {creating === "client" ? (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={allServers} onChange={(event) => setAllServers(event.target.checked)} />
                All servers I can access
              </label>
              {!allServers ? (
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                  {servers.length ? (
                    servers.map((server) => (
                      <label key={server.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                        <input
                          type="checkbox"
                          checked={serverIds.includes(server.id)}
                          onChange={(event) => {
                            setServerIds((current) =>
                              event.target.checked ? [...current, server.id] : current.filter((id) => id !== server.id),
                            );
                          }}
                        />
                        {server.name}
                      </label>
                    ))
                  ) : (
                    <p className="px-2 py-3 text-xs text-muted-foreground">No servers yet.</p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
          {creating === "application" ? (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={fullAccess} onChange={(event) => setFullAccess(event.target.checked)} />
                Full panel access
              </label>
              {!fullAccess ? (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  {APPLICATION_SCOPE_GROUPS.map((group) => (
                    <div key={group.key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>{group.label}</span>
                      <span className="flex gap-3 text-xs text-muted-foreground">
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={scopes.includes(group.read)}
                            onChange={(event) => toggleScope(group.read, event.target.checked)}
                          />
                          Read
                        </label>
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={scopes.includes(group.write)}
                            onChange={(event) => toggleScope(group.write, event.target.checked)}
                          />
                          Write
                        </label>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(secret)}
        onClose={() => setSecret(null)}
        title="Copy this key now"
        description="It is shown once. Store it like a password."
        footer={
          secret ? (
            <>
              <CopyButton value={secret.token} />
              <Button type="button" onClick={() => setSecret(null)}>
                Done
              </Button>
            </>
          ) : null
        }
      >
        {secret ? (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="font-medium">{secret.name}</span>{" "}
              <span className="text-muted-foreground">
                ({secret.kind === "application" ? "application" : "account"})
              </span>
            </p>
            <pre className="overflow-x-auto rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs">
              {secret.token}
            </pre>
            <p className="text-xs text-muted-foreground">
              Example:{" "}
              <span className="font-mono">
                curl -H &quot;Authorization: Bearer {secret.token.slice(0, 12)}…&quot; {secret.kind === "application" ? "/api/v1/admin/servers" : "/api/v1/client/servers"}
              </span>
            </p>
          </div>
        ) : (
          <EmptyState title="No key" />
        )}
      </Modal>
    </SettingsSection>
  );
}
