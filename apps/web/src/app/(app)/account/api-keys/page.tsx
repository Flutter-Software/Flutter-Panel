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
import { Button, EmptyState, Field, Input, Modal, Rack, RackRow, Select } from "@/components/ui";
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
      setActionError(err instanceof Error ? err.message : "The key wasn't created. Check the name and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string, label: string) {
    const ok = await confirm({
      title: "Revoke this key?",
      description: `Anything using ${label} stops working straight away. This can't be undone.`,
      confirmLabel: "Revoke key",
      danger: true,
    });
    if (!ok) return;
    setActionError(null);
    try {
      await api(`/api/v1/account/api-keys/${id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "The key wasn't revoked. Reload the page and try again.");
    }
  }

  function toggleScope(scope: ApplicationScope, on: boolean) {
    setScopes((current) => (on ? [...new Set([...current, scope])] : current.filter((item) => item !== scope)));
  }

  function KeyList({
    rows,
    label,
    empty,
  }: {
    rows: ApiKeyRow[];
    label: string;
    empty: { title: string; description: string };
  }) {
    if (!rows.length) {
      return <EmptyState title={empty.title} description={empty.description} />;
    }
    return (
      <Rack label={label}>
        {rows.map((row) => (
          <RackRow key={row.id} className="items-start">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-3">
                <span className="truncate font-display text-[17px] font-semibold leading-tight">{row.name}</span>
                <span className="font-mono text-[12.5px] text-muted-foreground">{row.tokenPrefix}••••</span>
              </p>
              <p className="mt-0.5 text-[13px]">
                {row.kind === "application"
                  ? scopeLabel(row.scopes)
                  : row.allServers
                    ? "All servers you can access"
                    : row.serverIds.map((id) => serverNames.get(id) || id).join(", ") || "No servers"}
              </p>
              {/* Dates as labelled fields, not a dotted meta string (DESIGN.md → Words). */}
              <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-0.5 text-[13px]">
                <div className="flex gap-1.5">
                  <dt className="text-muted-foreground">Created</dt>
                  <dd>{new Date(row.createdAt).toLocaleDateString()}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-muted-foreground">Last used</dt>
                  <dd>{row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : "Never"}</dd>
                </div>
                {row.expiresAt ? (
                  <div className="flex gap-1.5">
                    <dt className="text-muted-foreground">Expires</dt>
                    <dd>{new Date(row.expiresAt).toLocaleDateString()}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => void revoke(row.id, row.name)}>
              <Trash2 className="size-3.5" />
              Revoke
            </Button>
          </RackRow>
        ))}
      </Rack>
    );
  }

  return (
    <SettingsSection
      title="API keys"
      description="Keys let scripts, bots and billing systems use the panel API without signing in."
    >
      {error || actionError ? (
        <p role="alert" className="text-sm text-status-error">
          {actionError ?? error}
        </p>
      ) : null}

      <section aria-labelledby="account-keys" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h3 id="account-keys" className="text-[20px] font-semibold">
              Account keys
            </h3>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Act as you on <code className="text-[12.5px] text-foreground">/api/v1/client</code>. Send{" "}
              <code className="text-[12.5px] text-foreground">Authorization: Bearer {API_KEY_CLIENT_PREFIX}…</code>
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
            Create account key
          </Button>
        </div>
        <KeyList
          rows={clientKeys}
          label="Account keys"
          empty={{
            title: "No account keys yet",
            description: "Create one to control your servers from a script or bot.",
          }}
        />
      </section>

      {admin ? (
        <section aria-labelledby="application-keys" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h3 id="application-keys" className="text-[20px] font-semibold">
                Application keys
              </h3>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Manage the panel through <code className="text-[12.5px] text-foreground">/api/v1/admin</code>,
                including one-time login URLs for HostCore or WHMCS. Send{" "}
                <code className="text-[12.5px] text-foreground">
                  Authorization: Bearer {API_KEY_APPLICATION_PREFIX}…
                </code>
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
              Create application key
            </Button>
          </div>
          <KeyList
            rows={applicationKeys}
            label="Application keys"
            empty={{
              title: "No application keys yet",
              description: "Create one to connect a billing system or admin tool.",
            }}
          />
        </section>
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
                <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-border bg-well p-1.5">
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
                    <p className="px-2 py-3 text-[13px] text-muted-foreground">You don&apos;t have any servers yet.</p>
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
                <div className="divide-y divide-border rounded-md border border-border bg-well">
                  {APPLICATION_SCOPE_GROUPS.map((group) => (
                    <div key={group.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span>{group.label}</span>
                      <span className="flex gap-4 text-[13px] text-muted-foreground">
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
        description="This is the only time the full key is shown. Store it somewhere safe, like a password manager."
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
            <pre className="overflow-x-auto rounded-md border border-border bg-well px-3 py-2 font-mono text-[13px]">
              {secret.token}
            </pre>
            <p className="text-[13px] text-muted-foreground">
              Try it:{" "}
              <span className="font-mono text-[12.5px]">
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
