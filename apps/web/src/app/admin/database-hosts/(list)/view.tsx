"use client";

import { useCallback, type ReactNode } from "react";
import Link from "next/link";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { AdminPage } from "@/components/admin-table";
import { AdminDatabaseHostsPageSkeleton } from "@/components/skeletons";
import { QueryErrorPage } from "@/components/error-page";
import { confirm } from "@/components/confirm-dialog";
import { Button, ButtonLink, EmptyState, Rack, RowField } from "@/components/ui";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { prefetchQuery, useQuery } from "@/lib/query";
import type { DatabaseHostRecord } from "../types";

const COLUMNS = "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.6fr)_minmax(0,1fr)_auto]";

export default function AdminDatabaseHostsPage({ skeletonCount }: { skeletonCount?: number }) {
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

  if (!data) {
    return <AdminDatabaseHostsPageSkeleton count={skeletonCount} />;
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
      {rows.length === 0 ? (
        <EmptyState
          title="No database hosts yet"
          description="Add a MySQL or MariaDB server the panel can manage, then give game servers a database limit."
        />
      ) : (
        <div>
          {/* Column legend for wide screens; rows wrap into labelled lines below lg. */}
          <div aria-hidden className={cn("hidden px-4 py-2 text-[12px] text-muted-foreground lg:grid lg:gap-5", COLUMNS)}>
            <span className="pl-1">Host</span>
            <span>Address</span>
            <span>Databases</span>
            <span>Nodes</span>
            <span className="w-[7.5rem]" />
          </div>
          <Rack label="Database hosts">
            {rows.map((host) => (
              <div
                key={host.id}
                role="listitem"
                className={cn("relative grid gap-2 px-4 py-3 sm:grid-cols-2 lg:items-center lg:gap-5", COLUMNS)}
              >
                <div className="min-w-0 pl-1 sm:col-span-2 lg:col-span-1">
                  <Link
                    href={`/admin/database-hosts/${host.id}`}
                    onMouseEnter={() => prefetchQuery(`/api/v1/admin/database-hosts/${host.id}`)}
                    className="truncate font-display text-[17px] font-semibold leading-tight hover:text-primary"
                  >
                    {host.name}
                  </Link>
                </div>
                <RowField breakpoint="lg" label="Address">
                  <span className="font-mono text-[12.5px]">
                    {host.endpoint.host}:{host.endpoint.port}
                  </span>
                </RowField>
                <RowField breakpoint="lg" label="Databases">
                  <span className="tabular-nums">{host.databaseCount}</span>
                  {host.maxDatabases > 0 ? (
                    <span className="text-muted-foreground">
                      {" "}
                      of <span className="tabular-nums">{host.maxDatabases}</span>
                    </span>
                  ) : null}
                </RowField>
                <RowField breakpoint="lg" label="Nodes">
                  {host.nodeIds.length === 0 ? (
                    <span className="text-muted-foreground">Every node</span>
                  ) : (
                    host.nodeNames.join(", ") || `${host.nodeIds.length} node${host.nodeIds.length === 1 ? "" : "s"}`
                  )}
                </RowField>
                <div className="flex items-center gap-1.5 pl-1 lg:w-[7.5rem] lg:justify-end lg:pl-0">
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
                    title={host.databaseCount > 0 ? "Delete this host's databases before deleting it" : undefined}
                    disabled={host.databaseCount > 0}
                    onClick={() => void onDelete(host)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </Rack>
        </div>
      )}
    </AdminPage>
  );
}

