"use client";

import { use, useCallback, useEffect, useState, type ReactNode } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { confirm } from "@/components/confirm-dialog";
import { Button, EmptyState, Rack, RowField } from "@/components/ui";
import { useServerRecord } from "@/components/server-frame";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/types";
import { ServerSection } from "@/components/server-section";

type Backup = { id: string; name: string; size: number; createdAt: string };

export default function BackupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const server = useServerRecord();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const enabled = server?.backupsEnabled !== false;

  const load = useCallback(() => {
    return api<{ data: { backups: Backup[] } }>(`/api/v1/client/servers/${id}/backups`, {
      method: "POST",
      body: JSON.stringify({ action: "list" }),
    })
      .then((result) => setBackups(result.data.backups ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [id]);

  useEffect(() => {
    if (!enabled) return;
    load();
  }, [enabled, load]);

  async function run(action: string, backupId?: string) {
    setError(null);
    setPending(true);
    try {
      await api(`/api/v1/client/servers/${id}/backups`, {
        method: "POST",
        body: JSON.stringify({ action, id: backupId }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backup action failed");
    } finally {
      setPending(false);
    }
  }

  if (server && !enabled) {
    return (
      <ServerSection
        title="Backups"
        description="Archives stored on the node next to this server."
        emptyTitle="Backups are turned off"
        emptyDescription="An administrator can turn them on when editing this server in Admin."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold">Backups</h2>
          <p className="text-sm text-muted-foreground">Archives stored on the node next to this server.</p>
        </div>
        <Button type="button" disabled={pending} onClick={() => void run("create")}>
          <Plus className="size-4" />
          {pending ? "Working…" : "Create backup"}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {backups.length === 0 ? (
        <EmptyState
          title="No backups yet"
          description="Create one to save a copy of this server's files."
        />
      ) : (
        <div>
          {/* Column legend for wide screens; below md each row labels its own fields. */}
          <div
            aria-hidden
            className="hidden px-4 py-2 text-[12px] text-muted-foreground md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,0.7fr)_minmax(0,1.2fr)_auto] md:gap-5"
          >
            <span>Backup</span>
            <span>Size</span>
            <span>Created</span>
            <span className="w-[10rem]" />
          </div>
          <Rack label="Backups">
            {backups.map((backup) => (
              <div
                key={backup.id}
                role="listitem"
                className="relative grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,0.7fr)_minmax(0,1.2fr)_auto] md:items-center md:gap-5"
              >
                <p className="min-w-0 truncate font-display text-[16px] font-semibold leading-tight">{backup.name}</p>
                <RowField breakpoint="md" label="Size">
                  <span className="tabular-nums">{formatBytes(backup.size)}</span>
                </RowField>
                <RowField breakpoint="md" label="Created">
                  <span className="tabular-nums">{new Date(backup.createdAt).toLocaleString()}</span>
                </RowField>
                <div className="flex items-center gap-1.5 md:w-[10rem] md:justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={pending}
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: "Restore backup",
                          description: "The server will be stopped first.",
                          confirmLabel: "Restore",
                        }))
                      ) {
                        return;
                      }
                      void run("restore", backup.id);
                    }}
                  >
                    <RotateCcw className="size-3.5" />
                    Restore
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    className="size-8 px-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${backup.name}`}
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: "Delete backup",
                          description: "Delete this backup? This cannot be undone.",
                          confirmLabel: "Delete",
                        }))
                      ) {
                        return;
                      }
                      void run("delete", backup.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </Rack>
        </div>
      )}
    </div>
  );
}

