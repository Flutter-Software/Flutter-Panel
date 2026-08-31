"use client";

import { use, useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { confirm } from "@/components/confirm-dialog";
import { Button, Card } from "@/components/ui";
import { useServerRecord } from "@/components/server-frame";
import { api } from "@/lib/api";
import { ServerSection } from "@/components/server-section";

type Backup = { id: string; name: string; size: number; createdAt: string };

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
        description="Backups are disabled for this server. An administrator can turn them on from the server edit page."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Backups</h2>
          <p className="text-sm text-muted-foreground">Archives stored on the node next to this server.</p>
        </div>
        <Button type="button" disabled={pending} onClick={() => void run("create")}>
          <Plus className="size-4" />
          {pending ? "Working…" : "Create backup"}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Backup</th>
              <th className="px-4 py-2.5 font-medium">Size</th>
              <th className="px-4 py-2.5 font-medium">Created</th>
              <th className="px-4 py-2.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {backups.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={4}>
                  No backups yet.
                </td>
              </tr>
            ) : (
              backups.map((backup) => (
                <tr key={backup.id} className="border-t border-border">
                  <td className="px-4 py-3 font-mono text-xs">{backup.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatSize(backup.size)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(backup.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
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
                        Restore
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        className="text-destructive"
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
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
