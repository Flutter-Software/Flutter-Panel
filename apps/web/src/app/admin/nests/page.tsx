"use client";

import Link from "next/link";
import { Box, Boxes, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { AdminPage, ListSkeleton } from "@/components/admin-table";
import { QueryErrorPage } from "@/components/error-page";
import { confirm } from "@/components/confirm-dialog";
import { Button, ButtonLink, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { prefetchQuery, useQuery } from "@/lib/query";
import type { NestRecord } from "./nest-form";

export default function AdminNestsPage() {
  const { data, error, errorStatus, reload } = useQuery<{ data: { nests: NestRecord[] } }>("/api/v1/admin/nests");
  const nests = data?.data.nests ?? [];

  async function onDeleteNest(nest: NestRecord) {
    if (
      !(await confirm({
        title: "Delete nest",
        description: `Delete ${nest.name}? Unused eggs in this nest are deleted too.`,
        confirmLabel: "Delete",
      }))
    ) {
      return;
    }
    try {
      await api(`/api/v1/admin/nests/${nest.id}`, { method: "DELETE" });
      await reload();
    } catch {
      await reload();
    }
  }

  async function onDeleteEgg(name: string, id: string) {
    if (
      !(await confirm({
        title: "Delete egg",
        description: `Delete ${name}? This cannot be undone.`,
        confirmLabel: "Delete",
      }))
    ) {
      return;
    }
    try {
      await api(`/api/v1/admin/eggs/${id}`, { method: "DELETE" });
      await reload();
    } catch {
      await reload();
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

  return (
    <AdminPage
      title="Nests"
      description="Eggs, Docker images, and startup commands. Import a Pterodactyl or Pelican egg JSON, or create your own."
      actions={
        <>
          <ButtonLink href="/admin/nests/eggs/import" variant="secondary">
            <Upload className="size-4" />
            Import egg
          </ButtonLink>
          <ButtonLink href="/admin/nests/eggs/new" variant="secondary">
            <Box className="size-4" />
            New egg
          </ButtonLink>
          <ButtonLink href="/admin/nests/new">
            <Plus className="size-4" />
            New nest
          </ButtonLink>
        </>
      }
    >
      {!data ? (
        <ListSkeleton />
      ) : nests.length === 0 ? (
        <Card className="px-6 py-16 text-center">
          <p className="text-base font-semibold">No nests yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a nest first, then add or import eggs into it.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {nests.map((nest) => {
            const servers = nest.eggs.reduce((sum, egg) => sum + (egg.serverCount ?? 0), 0);
            return (
              <Card key={nest.id} className="p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <Link
                    href={`/admin/nests/${nest.id}`}
                    onMouseEnter={() => prefetchQuery(`/api/v1/admin/nests/${nest.id}`)}
                    className="min-w-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Boxes className="size-4 text-muted-foreground" />
                      <span className="text-base font-semibold">{nest.name}</span>
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {nest.eggCount} egg{nest.eggCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {nest.description || "No description"}
                    </p>
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <ButtonLink
                      href={`/admin/nests/eggs/new?nestId=${nest.id}`}
                      variant="secondary"
                      size="sm"
                    >
                      <Plus className="size-3.5" />
                      Egg
                    </ButtonLink>
                    <ButtonLink href={`/admin/nests/${nest.id}`} variant="secondary" size="sm">
                      <Pencil className="size-3.5" />
                      Edit
                    </ButtonLink>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="size-8 px-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${nest.name}`}
                      disabled={servers > 0}
                      onClick={() => onDeleteNest(nest)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                {nest.eggs.length > 0 ? (
                  <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
                    {nest.eggs.map((egg) => (
                      <li key={egg.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <Link
                          href={`/admin/nests/eggs/${egg.id}`}
                          onMouseEnter={() => prefetchQuery(`/api/v1/admin/eggs/${egg.id}`)}
                          className="min-w-0"
                        >
                          <p className="text-sm font-medium">{egg.name}</p>
                          <p className="truncate font-mono text-xs text-muted-foreground">
                            {egg.dockerImage}
                          </p>
                        </Link>
                        <div className="flex shrink-0 items-center gap-1">
                          <ButtonLink href={`/admin/nests/eggs/${egg.id}`} variant="ghost" size="sm">
                            <Pencil className="size-3.5" />
                            Edit
                          </ButtonLink>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="size-8 px-0 text-muted-foreground hover:text-destructive"
                            aria-label={`Delete ${egg.name}`}
                            disabled={Boolean(egg.serverCount)}
                            onClick={() => onDeleteEgg(egg.name, egg.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">No eggs in this nest.</p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </AdminPage>
  );
}
