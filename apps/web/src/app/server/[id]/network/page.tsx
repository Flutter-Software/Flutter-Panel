"use client";

import { use, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Star } from "lucide-react";
import { confirm } from "@/components/confirm-dialog";
import { Button, EmptyState, Field, Input, Rack, buttonClass } from "@/components/ui";
import { toast } from "@/components/toast";
import { useServerRecord } from "@/components/server-frame";
import { api } from "@/lib/api";
import { can } from "@/lib/access";
import { invalidateQuery, useQuery } from "@/lib/query";

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

function AllocationRow({
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
    <div
      role="listitem"
      className="relative grid gap-3 px-4 py-3.5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] lg:items-end lg:gap-5"
    >
      {/* The primary address gets the cyan rule: it's the one the process binds to. */}
      {row.primary ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-primary" /> : null}
      <div className="min-w-0 self-center pl-1">
        <p className="truncate font-mono text-[15px] font-medium tabular-nums">{row.display}</p>
        <p className="truncate text-[13px] text-muted-foreground">
          {row.primary ? <span className="font-medium text-primary">Primary</span> : "Additional"}
          {row.alias && row.display !== raw ? (
            <>
              {", "}
              <span className="font-mono text-[12px]">{raw}</span>
            </>
          ) : null}
        </p>
      </div>
      <Field label="Alias" extra={<CopyButton value={alias.trim() || row.ip} label="host" />}>
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
      <div className="flex flex-wrap items-center gap-1.5 pl-1 lg:justify-end lg:pl-0">
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
            Make primary
          </Button>
        ) : null}
      </div>
    </div>
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
      toast("Primary address updated", "success");
    } catch {
      /* toasted */
    }
  }

  if (!server) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-[20px] font-semibold">Network</h2>
          <p className="text-sm text-muted-foreground">Loading this server…</p>
        </div>
      </div>
    );
  }

  if (!canRead) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-[20px] font-semibold">Network</h2>
          <p className="text-sm text-muted-foreground">You do not have permission to view allocations on this server.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[20px] font-semibold">Network</h2>
        <p className="text-sm text-muted-foreground">
          Addresses assigned to this server. The primary address is the one the process binds to. An alias is shown
          instead of the IP and doesn&apos;t change the bind address.
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
        <Rack label="Allocations">
          {rows.map((row) => (
            <AllocationRow
              key={row.id}
              row={row}
              canUpdate={canUpdate}
              pending={pendingId === row.id}
              onSave={onSave}
              onPrimary={onPrimary}
            />
          ))}
        </Rack>
      )}
    </div>
  );
}
