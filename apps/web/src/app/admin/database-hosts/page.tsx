"use client";

import { useCallback } from "react";
import Link from "next/link";
import { Database, Pencil, Plus, Trash2 } from "lucide-react";
import { AdminPage, ListSkeleton } from "@/components/admin-table";
import { QueryErrorPage } from "@/components/error-page";
import { confirm } from "@/components/confirm-dialog";
import { Button, ButtonLink, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { prefetchQuery, useQuery } from "@/lib/query";
import type { DatabaseHostRecord } from "./types";

export default function AdminDatabaseHostsPage() {
  const { data, error, errorStatus, reload } = useQuery<{ data: { hosts: DatabaseHostRecord[] } }>(
    "/api/v1/admin/database-hosts",
  );
  const rows = data?.data.hosts ?? [];

  const onDelete = useCallback(
    async (host: DatabaseHostRecord) => {
      if (
        !(await confirm({
          title: "Delete database host",
          description: `Delete ${host.name}? Existing databases on this host must be removed first.`,
          confirmLabel: "Delete",
        }))
      ) {
        return;
      }
      try {
        await api(`/api/v1/admin/database-hosts/${host.id}`, { method: "DELETE" });
        await reload();
      } catch {
        await reload();
      }
    },
    [reload],
  );

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

  return (
    <AdminPage
      title="Database hosts"
      actions={
        <ButtonLink href="/admin/database-hosts/new">
          <Plus className="size-4" />
          New host
        </ButtonLink>
      }
    >
      {!data ? (
        <ListSkeleton />
      ) : rows.length === 0 ? (
        <Card className="px-6 py-16 text-center">
          <p className="text-base font-semibold">No database hosts yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a MySQL or MariaDB server the panel can manage, then give game servers a database limit.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {rows.map((host) => (
            <Card key={host.id} className="p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <Link
                  href={`/admin/database-hosts/${host.id}`}
                  onMouseEnter={() => prefetchQuery(`/api/v1/admin/database-hosts/${host.id}`)}
                  className="min-w-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Database className="size-4 text-muted-foreground" />
                    <span className="text-base font-semibold">{host.name}</span>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {host.databaseCount}
                      {host.maxDatabases > 0 ? `/${host.maxDatabases}` : ""} database
                      {host.databaseCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-sm text-muted-foreground">
                    {host.endpoint.host}:{host.endpoint.port}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {host.nodeIds.length === 0
                      ? "Available on every node"
                      : host.nodeNames.join(" · ") || `${host.nodeIds.length} node${host.nodeIds.length === 1 ? "" : "s"}`}
                  </p>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  <ButtonLink href={`/admin/database-hosts/${host.id}`} variant="secondary" size="sm">
                    <Pencil className="size-3.5" />
                    Edit
                  </ButtonLink>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="size-8 px-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${host.name}`}
                    disabled={host.databaseCount > 0}
                    onClick={() => void onDelete(host)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AdminPage>
  );
}
