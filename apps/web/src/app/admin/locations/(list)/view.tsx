"use client";

import { useCallback } from "react";
import Link from "next/link";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { AdminPage } from "@/components/admin-table";
import { AdminLocationsPageSkeleton } from "@/components/skeletons";
import { QueryErrorPage } from "@/components/error-page";
import { confirm } from "@/components/confirm-dialog";
import { Button, ButtonLink, EmptyState, Rack } from "@/components/ui";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { prefetchQuery, useQuery } from "@/lib/query";
import type { LocationRecord } from "../location-form";

const COLUMNS = "md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)_minmax(0,0.5fr)_auto]";

export default function AdminLocationsPage({ skeletonCount }: { skeletonCount?: number }) {
  const { data, error, errorStatus, reload } = useQuery<{ data: { locations: LocationRecord[] } }>(
    "/api/v1/admin/locations",
  );
  const rows = data?.data.locations ?? [];

  const onDelete = useCallback(
    async (location: LocationRecord) => {
      if (
        !(await confirm({
          title: "Delete location",
          description: `Delete ${location.shortCode}? This can't be undone.`,
          confirmLabel: "Delete",
        }))
      ) {
        return;
      }
      try {
        await api(`/api/v1/admin/locations/${location.id}`, { method: "DELETE" });
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
    return <AdminLocationsPageSkeleton count={skeletonCount} />;
  }

  return (
    <AdminPage
      title="Locations"
      actions={
        <ButtonLink href="/admin/locations/new">
          <Plus className="size-4" />
          New location
        </ButtonLink>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          title="No locations yet"
          description="Create a location for each region or datacenter, then add nodes to it."
        />
      ) : (
        <div>
          {/* Column legend for wide screens; rows wrap into labelled lines below md. */}
          <div aria-hidden className={cn("hidden px-4 py-2 text-[12px] text-muted-foreground md:grid md:gap-5", COLUMNS)}>
            <span className="pl-1">Location</span>
            <span>Description</span>
            <span>Nodes</span>
            <span className="w-[7.5rem]" />
          </div>
          <Rack label="Locations">
            {rows.map((location) => {
              const nodes = location.nodeCount ?? 0;
              return (
                <div
                  key={location.id}
                  role="listitem"
                  className={cn("relative grid gap-2 px-4 py-3 md:items-center md:gap-5", COLUMNS)}
                >
                  <div className="min-w-0 pl-1">
                    <Link
                      href={`/admin/locations/${location.id}`}
                      onMouseEnter={() => prefetchQuery(`/api/v1/admin/locations/${location.id}`)}
                      className="truncate font-display text-[17px] font-semibold leading-tight hover:text-primary"
                    >
                      {location.shortCode}
                    </Link>
                  </div>
                  <p className="min-w-0 truncate pl-1 text-sm text-muted-foreground md:pl-0">
                    {location.description || "No description"}
                  </p>
                  <p className="pl-1 text-sm text-muted-foreground md:pl-0">
                    <span className="tabular-nums text-foreground">{nodes}</span>{" "}
                    {nodes === 1 ? "node" : "nodes"}
                  </p>
                  <div className="flex items-center gap-1.5 pl-1 md:w-[7.5rem] md:justify-end md:pl-0">
                    <ButtonLink href={`/admin/locations/${location.id}`} variant="secondary" size="sm">
                      <Pencil className="size-3.5" />
                      Edit
                    </ButtonLink>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="size-8 px-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${location.shortCode}`}
                      title={nodes ? "Move this location's nodes elsewhere before deleting it" : undefined}
                      disabled={Boolean(location.nodeCount)}
                      onClick={() => onDelete(location)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </Rack>
        </div>
      )}
    </AdminPage>
  );
}
