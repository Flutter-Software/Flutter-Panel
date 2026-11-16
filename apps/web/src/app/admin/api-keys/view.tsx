"use client";

/**
 * Admin → API Keys.
 *
 * Panel-wide management of *application* keys (`fla_…`), the bearer tokens
 * that drive `/api/v1/admin` for billing systems, bots and scripts.
 *
 * Unlike Account → API keys (which only lists the caller's own keys), this
 * page lists every admin's application keys with their owner, so a key left
 * behind by a former admin can be found and revoked.
 *
 * Backend: GET/POST /api/v1/admin/api-keys, DELETE /api/v1/admin/api-keys/:id.
 * Those routes require a signed-in browser session, so a leaked key can't be
 * used to mint new keys.
 */

import { useState, type ReactNode } from "react";
import { Check, Copy, Plus, ShieldCheck, Trash2 } from "lucide-react";
import {
  API_KEY_APPLICATION_PREFIX,
  APPLICATION_SCOPE_GROUPS,
  type ApplicationScope,
} from "@flutter-software/shared";
import { AdminError, AdminPage } from "@/components/admin-table";
import { confirm } from "@/components/confirm-dialog";
import { QueryErrorPage } from "@/components/error-page";
import { AdminApiKeysPageSkeleton } from "@/components/skeletons";
import { toast } from "@/components/toast";
import { Button, EmptyState, Field, Input, Modal, Rack, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useQuery } from "@/lib/query";

const KEYS_PATH = "/api/v1/admin/api-keys";

type AdminApiKey = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  owner: { id: string; username: string | null };
};

/** Per-resource access level picked in the create form. Write implies read. */
type Access = "none" | "read" | "write";

const ACCESS_OPTIONS: { value: Access; label: string }[] = [
  { value: "none", label: "None" },
  { value: "read", label: "Read" },
  { value: "write", label: "Read & write" },
];

const EXPIRY_OPTIONS = [
  { value: "", label: "Never" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
];

function emptyAccess(): Record<string, Access> {
  return Object.fromEntries(APPLICATION_SCOPE_GROUPS.map((group) => [group.key, "none" as Access]));
}

/** Turns the per-group picker state into the scope list the API expects. */
function scopesFromAccess(access: Record<string, Access>): ApplicationScope[] {
  return APPLICATION_SCOPE_GROUPS.flatMap((group) => {
    const level = access[group.key];
    if (level === "write") return [group.read, group.write];
    if (level === "read") return [group.read];
    return [];
  });
}

/** Collapses stored scopes into one chip per resource ("Servers: write"). */
function scopeChips(scopes: string[]): string[] {
  if (!scopes.length || scopes.includes("*")) return [];
  return APPLICATION_SCOPE_GROUPS.flatMap((group) => {
    if (scopes.includes(group.write)) return [`${group.label}: write`];
    if (scopes.includes(group.read)) return [`${group.label}: read`];
    return [];
  });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** "just now", "5 min ago", "3 h ago", "12 days ago", then a plain date. */
function formatRelative(iso: string) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 86_400 * 30) {
    const days = Math.floor(seconds / 86_400);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  return formatDate(iso);
}

function isExpired(row: AdminApiKey) {
  return Boolean(row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now());
}

export default function AdminApiKeysPage() {
  const { data, error, errorStatus, reload } = useQuery<{ data: { keys: AdminApiKey[] } }>(KEYS_PATH);
  const keys = data?.data.keys ?? [];

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [fullAccess, setFullAccess] = useState(true);
  const [access, setAccess] = useState<Record<string, Access>>(emptyAccess);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ name: string; token: string } | null>(null);

  const customScopes = scopesFromAccess(access);
  const canCreate = Boolean(name.trim()) && (fullAccess || customScopes.length > 0) && !busy;

  function openCreate() {
    setName("");
    setExpiresInDays("");
    setFullAccess(true);
    setAccess(emptyAccess());
    setFormError(null);
    setCreating(true);
  }

  async function createKey() {
    if (!canCreate) return;
    setBusy(true);
    setFormError(null);
    try {
      const result = await api<{ data: { key: AdminApiKey; token: string } }>(KEYS_PATH, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          scopes: fullAccess ? ["*"] : customScopes,
          expiresInDays: expiresInDays ? Number(expiresInDays) : null,
        }),
      });
      setCreating(false);
      // The plaintext token exists only in this response; show it once.
      setSecret({ name: result.data.key.name, token: result.data.token });
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't create the API key. Check the name and access, then try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(row: AdminApiKey) {
    const ok = await confirm({
      title: "Revoke API key?",
      description: `${row.name} will stop working immediately. Anything using it will get 401 errors.`,
      confirmLabel: "Revoke",
      danger: true,
    });
    if (!ok) return;
    setActionError(null);
    try {
      await api(`${KEYS_PATH}/${row.id}`, { method: "DELETE" });
      toast(`Revoked ${row.name}.`, "success");
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't revoke the API key. Refresh the page and try again.");
    }
  }

  if (error && !data) {
    return (
      <QueryErrorPage
        error={error}
        status={errorStatus}
        onRetry={() => void reload()}
        homeHref="/admin"
        homeLabel="Back to admin"
      />
    );
  }

  if (!data) return <AdminApiKeysPageSkeleton />;

  return (
    <AdminPage
      title="API keys"
      description="Application keys give scripts, bots and billing systems full or limited access to the admin API."
      actions={
        <Button type="button" onClick={openCreate}>
          <Plus className="size-4" />
          New API key
        </Button>
      }
    >
      <AdminError message={actionError} />

      <p className="max-w-[72ch] text-sm text-muted-foreground">
        To use a key, send{" "}
        <code className="break-all font-mono text-[13px] text-foreground">
          Authorization: Bearer {API_KEY_APPLICATION_PREFIX}…
        </code>{" "}
        with any request to <code className="font-mono text-[13px] text-foreground">/api/v1/admin</code>.
      </p>

      {keys.length === 0 ? (
        <EmptyState
          title="No API keys yet"
          description="Create a key to connect HostCore, WHMCS, a Discord bot or your own scripts to this panel."
        />
      ) : (
        <div>
          {/* Column legend for wide screens; rows wrap into labelled lines below lg. */}
          <div aria-hidden className={cn("hidden px-4 py-2 text-[12px] text-muted-foreground lg:grid lg:gap-5", KEY_COLUMNS)}>
            <span className="pl-1">Key</span>
            <span>Access</span>
            <span>Created</span>
            <span>Last used</span>
            <span>Expires</span>
            <span className="w-[6.5rem]" />
          </div>
          <Rack label="API keys">
            {keys.map((row) => (
              <KeyRow key={row.id} row={row} onRevoke={() => void revoke(row)} />
            ))}
          </Rack>
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => {
          if (!busy) setCreating(false);
        }}
        title="New API key"
        description="The key acts with admin rights, limited to the access you pick below."
        footer={
          <>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={!canCreate} onClick={() => void createKey()}>
              {busy ? "Creating…" : "Create key"}
            </Button>
          </>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void createKey();
          }}
        >
          {formError ? <p className="border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p> : null}
          <Field label="Name" required>
            <Input
              autoFocus
              maxLength={64}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="WHMCS, Discord bot, backups"
            />
          </Field>
          <Field label="Expires">
            <Select compact value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)}>
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="space-y-2">
            <p className="text-sm font-medium">Access</p>
            <div className="grid grid-cols-2 gap-2">
              <AccessChoice
                active={fullAccess}
                title="Full access"
                hint="Every admin endpoint"
                onClick={() => setFullAccess(true)}
              />
              <AccessChoice
                active={!fullAccess}
                title="Custom"
                hint="Pick per resource"
                onClick={() => setFullAccess(false)}
              />
            </div>
            {!fullAccess ? (
              <div className="divide-y divide-border rounded-lg border border-border">
                {APPLICATION_SCOPE_GROUPS.map((group) => (
                  <div key={group.key} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-sm">{group.label}</span>
                    <Segmented
                      label={`${group.label} access`}
                      value={access[group.key] ?? "none"}
                      onChange={(value) => setAccess((current) => ({ ...current, [group.key]: value }))}
                    />
                  </div>
                ))}
              </div>
            ) : null}
            {!fullAccess && customScopes.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Give the key access to at least one resource.</p>
            ) : null}
          </div>
          {/* Hidden submit so Enter in the name field creates the key. */}
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
      </Modal>

      <Modal
        open={Boolean(secret)}
        onClose={() => setSecret(null)}
        title="Copy your new API key"
        description="This is the only time it will be shown. Store it like a password."
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
            <p className="text-sm font-medium">{secret.name}</p>
            <pre className="overflow-x-auto rounded-md border border-border bg-well px-3 py-2.5 font-mono text-[12.5px]">
              {secret.token}
            </pre>
            <div>
              <p className="text-[13px] text-muted-foreground">Try it:</p>
              <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-well px-3 py-2.5 font-mono text-[12px] text-muted-foreground">
                {`curl -H "Authorization: Bearer ${secret.token}" \\\n  ${typeof window === "undefined" ? "" : window.location.origin}/api/v1/admin/servers`}
              </pre>
            </div>
          </div>
        ) : null}
      </Modal>
    </AdminPage>
  );
}

const KEY_COLUMNS =
  "lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto]";

function KeyRow({ row, onRevoke }: { row: AdminApiKey; onRevoke: () => void }) {
  const expired = isExpired(row);
  const chips = scopeChips(row.scopes);
  return (
    <div
      role="listitem"
      className={cn("relative grid gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-2 lg:items-start lg:gap-5", KEY_COLUMNS)}
    >
      {/* Only an expired key carries a rail: it's the one state that needs attention. */}
      {expired ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-status-error" /> : null}
      <div className="min-w-0 pl-1 sm:col-span-2 lg:col-span-1">
        <p className="truncate font-display text-[17px] font-semibold leading-tight">{row.name}</p>
        <p className="truncate font-mono text-[12.5px] text-muted-foreground">{row.tokenPrefix}••••</p>
      </div>
      <KeyField label="Access">
        {chips.length ? (
          <span className="whitespace-normal">{chips.join(", ")}</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-medium text-status-warn">
            <ShieldCheck className="size-3.5" aria-hidden />
            Full access
          </span>
        )}
      </KeyField>
      <KeyField label="Created">
        <span className="tabular-nums">{formatDate(row.createdAt)}</span>
        <span className="block truncate text-[13px] text-muted-foreground">
          {row.owner.username ? `by ${row.owner.username}` : "Owner deleted"}
        </span>
      </KeyField>
      <KeyField label="Last used">
        {row.lastUsedAt ? (
          <span className="tabular-nums">{formatRelative(row.lastUsedAt)}</span>
        ) : (
          <span className="text-muted-foreground">Never</span>
        )}
      </KeyField>
      <KeyField label="Expires">
        {!row.expiresAt ? (
          <span className="text-muted-foreground">Never</span>
        ) : expired ? (
          <span className="font-medium text-status-error">
            Expired <span className="tabular-nums">{formatDate(row.expiresAt)}</span>
          </span>
        ) : (
          <span className="tabular-nums">{formatDate(row.expiresAt)}</span>
        )}
      </KeyField>
      <div className="flex items-center pl-1 lg:w-[6.5rem] lg:justify-end lg:pl-0">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          aria-label={`Revoke ${row.name}`}
          onClick={onRevoke}
        >
          <Trash2 className="size-3.5" />
          Revoke
        </Button>
      </div>
    </div>
  );
}

/** A field in a key row. Its label is visible only when the row wraps (below lg), where there's no column legend. */
function KeyField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 pl-1 text-sm lg:pl-0">
      <p className="text-[12px] text-muted-foreground lg:sr-only">{label}</p>
      <div className="min-w-0 truncate">{children}</div>
    </div>
  );
}

function AccessChoice({
  active,
  title,
  hint,
  onClick,
}: {
  active: boolean;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40",
      )}
    >
      <span className="block text-sm font-medium">{title}</span>
      <span className="block text-[13px] text-muted-foreground">{hint}</span>
    </button>
  );
}

function Segmented({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Access;
  onChange: (value: Access) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-md border border-border p-0.5">
      {ACCESS_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-sm px-2 py-1 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            value === option.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        });
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "Copied" : "Copy key"}
    </Button>
  );
}
