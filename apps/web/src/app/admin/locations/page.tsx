"use client";

import { useCallback } from "react";
import Link from "next/link";
import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { AdminError, AdminPage, ListSkeleton } from "@/components/admin-table";
import { Button, ButtonLink, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { prefetchQuery, useQuery } from "@/lib/query";
import type { LocationRecord } from "./location-form";

export default function AdminLocationsPage() {
  const { data, error, reload } = useQuery<{ data: { locations: LocationRecord[] } }>(
    "/api/v1/admin/locations",
  );
  const rows = data?.data.locations ?? [];

  const onDelete = useCallback(
    async (location: LocationRecord) => {
      if (!window.confirm(`Delete location ${location.shortCode}? This cannot be undone.`)) return;
      try {
        await api(`/api/v1/admin/locations/${location.id}`, { method: "DELETE" });
        await reload();
      } catch {
        await reload();
      }
    },
    [reload],
  );

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
      <AdminError message={error} />
      {!data && !error ? (
        <ListSkeleton />
      ) : rows.length === 0 ? (
        <Card className="px-6 py-16 text-center">
          <p className="text-base font-semibold">No locations yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a location first, then add nodes to it.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {rows.map((location) => (
            <Card key={location.id} className="p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <Link
                  href={`/admin/locations/${location.id}`}
                  onMouseEnter={() => prefetchQuery(`/api/v1/admin/locations/${location.id}`)}
                  className="min-w-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <MapPin className="size-4 text-muted-foreground" />
                    <span className="font-mono text-base font-semibold">{location.shortCode}</span>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {location.nodeCount ?? 0} node{(location.nodeCount ?? 0) === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {location.description || "No description"}
                  </p>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
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
                    disabled={Boolean(location.nodeCount)}
                    onClick={() => onDelete(location)}
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
