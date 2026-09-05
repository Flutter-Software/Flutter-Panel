"use client";

import { use, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Star } from "lucide-react";
import { confirm } from "@/components/confirm-dialog";
import { Badge, Button, Card, EmptyState, Field, Input, buttonClass } from "@/components/ui";
import { toast } from "@/components/toast";
import { useServerRecord } from "@/components/server-frame";
import { api } from "@/lib/api";
import { can } from "@/lib/access";
import { invalidateQuery, useQuery } from "@/lib/query";
import { cn } from "@/lib/cn";

type Allocation = {
  id: string;
  ip: string;
  alias: string;
  port: number;
  notes: string;
  primary: boolean;
  display: string;
  http: boolean;
  url: string;
};

function CopyAction({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={!value}
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
      {copied ? <Check className="size-3.5 text-status-running" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

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

function AllocationCard({
  row,
  canUpdate,
  pending,
  onSave,
  onPrimary,
}: {
  row: Allocation;
  canUpdate: boolean;
  pending: boolean;
  onSave: (id: string, body: { notes: string; alias: string }) => Promise<void>;
  onPrimary: (row: Allocation) => Promise<void>;
}) {
  const [notes, setNotes] = useState(row.notes);
  const [alias, setAlias] = useState(row.alias);
  const raw = `${row.ip}:${row.port}`;
  const dirty = notes.trim() !== (row.notes || "") || alias.trim() !== (row.alias || "");

  useEffect(() => {
    setNotes(row.notes);
    setAlias(row.alias);
  }, [row.id, row.notes, row.alias]);

  async function saveIfDirty() {
    if (!canUpdate || !dirty || pending) return;
    await onSave(row.id, { notes: notes.trim(), alias: alias.trim() });
  }

  return (
    <Card className={cn("p-4", row.primary && "border-primary/40")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-sm font-semibold">{row.display}</p>
            {row.primary ? (
              <Badge className="rounded-full px-2">Primary</Badge>
            ) : (
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Additional
              </span>
            )}
          </div>
          {row.alias && row.display !== raw ? (
            <p className="mt-1 font-mono text-xs text-muted-foreground">{raw}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <CopyAction value={row.display} />
          {row.http && row.url ? (
            <a
              href={row.url}
              target="_blank"
              rel="noreferrer"
              className={buttonClass({ variant: "ghost", size: "sm" })}
            >
              <ExternalLink className="size-3.5" />
              Open
            </a>
          ) : null}
          {canUpdate && !row.primary ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => void onPrimary(row)}
            >
              <Star className="size-3.5" />
              Set primary
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Alias" hint="Shown instead of the IP. Does not change the bind address." extra={<CopyButton value={alias.trim() || row.ip} label="host" />}>
          <Input
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            onBlur={() => void saveIfDirty()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                (event.currentTarget as HTMLInputElement).blur();
              }
            }}
            maxLength={255}
            placeholder={row.ip}
            className="font-mono"
            disabled={!canUpdate || pending}
          />
        </Field>
        <Field label="Notes">
          <Input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            onBlur={() => void saveIfDirty()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                (event.currentTarget as HTMLInputElement).blur();
              }
            }}
            maxLength={240}
            placeholder="What this port is for"
            disabled={!canUpdate || pending}
          />
        </Field>
      </div>
    </Card>
  );
}

export default function NetworkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const server = useServerRecord();
  const { data, error, reload } = useQuery<{ data: { allocations: Allocation[] } }>(
    `/api/v1/client/servers/${id}/network`,
  );
  const rows = data?.data.allocations ?? [];
  const [pendingId, setPendingId] = useState<string | null>(null);
  const canRead = can(server, "allocation.read");
  const canUpdate = can(server, "allocation.update");

  async function patch(allocationId: string, body: { notes?: string; alias?: string; primary?: boolean }) {
    setPendingId(allocationId);
    try {
      await api(`/api/v1/client/servers/${id}/network/${allocationId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      invalidateQuery(`/api/v1/client/servers/${id}`);
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not update allocation");
      throw err;
    } finally {
      setPendingId(null);
    }
  }

  async function onSave(allocationId: string, body: { notes: string; alias: string }) {
    try {
      await patch(allocationId, body);
    } catch {
      /* toasted */
    }
  }

  async function onPrimary(row: Allocation) {
    if (
      !(await confirm({
        title: "Set primary address",
        description: `Use ${row.display} as the primary address? The process binds to this port after the next start or restart.`,
        confirmLabel: "Set primary",
      }))
    ) {
      return;
    }
    try {
      await patch(row.id, { primary: true });
      toast("Primary address updated", "info");
    } catch {
      /* toasted */
    }
  }

  if (!server) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Network</h2>
          <p className="text-sm text-muted-foreground">Loading this server…</p>
        </div>
      </div>
    );
  }

  if (!canRead) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Network</h2>
          <p className="text-sm text-muted-foreground">You do not have permission to view allocations on this server.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Network</h2>
        <p className="text-sm text-muted-foreground">
          Allocations assigned to this server. Notes and aliases are labels; the primary address is what the process
          binds to.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {rows.length === 0 ? (
        <EmptyState
          title={!data && !error ? "Loading allocations…" : "No allocations assigned"}
          description={
            data
              ? "An administrator can assign extra ports when creating or editing this server."
              : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <AllocationCard
              key={row.id}
              row={row}
              canUpdate={canUpdate}
              pending={pendingId === row.id}
              onSave={onSave}
              onPrimary={onPrimary}
            />
          ))}
        </div>
      )}
    </div>
  );
}
