"use client";

import Link from "next/link";
import { Box, Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { AdminPage } from "@/components/admin-table";
import { AdminNestsPageSkeleton } from "@/components/skeletons";
import { QueryErrorPage } from "@/components/error-page";
import { confirm } from "@/components/confirm-dialog";
import { Button, ButtonLink, EmptyState, Rack, buttonClass } from "@/components/ui";
import { api } from "@/lib/api";
import { prefetchQuery, useQuery } from "@/lib/query";
import type { NestRecord } from "../nest-form";

export default function AdminNestsPage({ skeletonNests }: { skeletonNests?: number[] }) {
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

  if (!data) {
    return <AdminNestsPageSkeleton nests={skeletonNests} />;
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
      {nests.length === 0 ? (
        <EmptyState
          title="No nests yet"
          description="Create a nest first, then add or import eggs into it."
        />
      ) : (
        // One section per nest: its name as a heading, then its eggs as a rack.
        <div className="space-y-8">
          {nests.map((nest) => {
            const servers = nest.eggs.reduce((sum, egg) => sum + (egg.serverCount ?? 0), 0);
            const headingId = `nest-${nest.id}`;
            return (
              <section key={nest.id} aria-labelledby={headingId} className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0">
                    <h2 id={headingId} className="text-[20px] font-semibold leading-tight">
                      <Link
                        href={`/admin/nests/${nest.id}`}
                        onMouseEnter={() => prefetchQuery(`/api/v1/admin/nests/${nest.id}`)}
                        className="hover:text-primary"
                      >
                        {nest.name}
                      </Link>
                    </h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {/* End the description with a full stop so the counts read as their own sentence. */}
                      {nest.description ? nest.description.replace(/([^.!?])$/, "$1.") : "No description."}{" "}
                      <span className="tabular-nums text-foreground/70">
                        {nest.eggCount} egg{nest.eggCount === 1 ? "" : "s"}
                        {servers ? `, used by ${servers} server${servers === 1 ? "" : "s"}` : ""}.
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <ButtonLink
                      href={`/admin/nests/eggs/new?nestId=${nest.id}`}
                      variant="secondary"
                      size="sm"
                    >
                      <Plus className="size-3.5" />
                      Add egg
                    </ButtonLink>
                    <ButtonLink href={`/admin/nests/${nest.id}`} variant="secondary" size="sm">
                      <Pencil className="size-3.5" />
                      Edit nest
                    </ButtonLink>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="size-8 px-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${nest.name}`}
                      title={servers > 0 ? "Servers still use eggs in this nest" : undefined}
                      disabled={servers > 0}
                      onClick={() => onDeleteNest(nest)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>

                {nest.eggs.length > 0 ? (
                  <Rack label={`Eggs in ${nest.name}`}>
                    {nest.eggs.map((egg) => (
                      <div
                        key={egg.id}
                        role="listitem"
                        className="grid gap-x-5 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_6.5rem_auto] sm:items-center"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/admin/nests/eggs/${egg.id}`}
                            onMouseEnter={() => prefetchQuery(`/api/v1/admin/eggs/${egg.id}`)}
                            className="block truncate font-display text-[17px] font-semibold leading-tight hover:text-primary"
                          >
                            {egg.name}
                          </Link>
                          {egg.description ? (
                            <p className="truncate text-[13px] text-muted-foreground">{egg.description}</p>
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[12px] text-muted-foreground sm:sr-only">Docker image</p>
                          <p className="truncate font-mono text-[12.5px]" title={egg.dockerImage}>
                            {egg.dockerImage}
                          </p>
                        </div>
                        <p className="text-[13px] tabular-nums text-muted-foreground">
                          {egg.serverCount ? (
                            <>
                              <span className="text-foreground">{egg.serverCount}</span> server
                              {egg.serverCount === 1 ? "" : "s"}
                            </>
                          ) : (
                            "No servers"
                          )}
                        </p>
                        <div className="flex items-center gap-1 sm:justify-end">
                          <ButtonLink
                            href={`/admin/nests/eggs/${egg.id}`}
                            variant="ghost"
                            size="sm"
                            aria-label={`Edit ${egg.name}`}
                          >
                            <Pencil className="size-3.5" />
                            Edit
                          </ButtonLink>
                          {/* Same JSON format as Import egg, so it can be re-imported here or into Pterodactyl / Pelican. */}
                          <a
                            href={`/api/v1/admin/eggs/${egg.id}/export`}
                            download
                            className={buttonClass({ variant: "ghost", size: "sm", className: "size-8 px-0 text-muted-foreground" })}
                            aria-label={`Download ${egg.name} as JSON`}
                            title="Download as JSON"
                          >
                            <Download className="size-4" />
                          </a>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="size-8 px-0 text-muted-foreground hover:text-destructive"
                            aria-label={`Delete ${egg.name}`}
                            title={egg.serverCount ? "Servers still use this egg" : undefined}
                            disabled={Boolean(egg.serverCount)}
                            onClick={() => onDeleteEgg(egg.name, egg.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </Rack>
                ) : (
                  <EmptyState
                    title="No eggs in this nest"
                    description="Add an egg by hand or import a Pterodactyl or Pelican egg JSON."
                  />
                )}
              </section>
            );
          })}
        </div>
      )}
    </AdminPage>
  );
}
