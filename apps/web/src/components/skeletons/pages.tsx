import { AdminFormPage, AdminPage } from "@/components/admin-table";
import { Skeleton, SkeletonCard, SkeletonRoot, skeletonKeys } from "@/components/skeleton";
import { clampSkeletonCount } from "@/lib/skeleton-counts";
import {
  AdminServerCardSkeleton,
  EntityCardSkeleton,
  NestCardSkeleton,
  NodeCardSkeleton,
  ServerCardSkeleton,
  UsersTableSkeleton,
} from "@/components/skeletons/items";

function ActionSkeleton({ className = "h-10 w-28" }: { className?: string }) {
  return <Skeleton className={className} />;
}

export function HomeServersSkeleton({ count }: { count?: number }) {
  const cards = clampSkeletonCount(count);
  return (
    <SkeletonRoot className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Server List</h1>
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          <Skeleton className="size-8" />
          <Skeleton className="size-8" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="ml-auto h-10 w-full sm:w-64" />
      </div>
      {cards ? (
        <div className="grid gap-4 md:grid-cols-2">
          {skeletonKeys(cards).map((index) => (
            <ServerCardSkeleton key={index} />
          ))}
        </div>
      ) : null}
    </SkeletonRoot>
  );
}

export function DashboardSkeleton({
  servers,
  nodes,
}: {
  servers?: number;
  nodes?: number;
}) {
  const serverRows = Math.min(8, clampSkeletonCount(servers));
  const nodeRows = Math.min(6, clampSkeletonCount(nodes, 1));
  return (
    <AdminPage
      title="Dashboard"
      description="Fleet, nodes, eggs, and accounts on this panel."
      actions={<ActionSkeleton />}
    >
      <SkeletonRoot className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {skeletonKeys(5).map((index) => (
            <SkeletonCard key={index} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-8 w-12" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="size-9" />
              </div>
            </SkeletonCard>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {skeletonKeys(4).map((index) => (
            <Skeleton key={index} className="h-8 w-24" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <SkeletonCard className="overflow-hidden lg:col-span-2">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-12" />
            </div>
            {serverRows ? (
              <ul className="divide-y divide-border">
                {skeletonKeys(serverRows).map((index) => (
                  <li key={index} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                    <Skeleton className="h-4 min-w-0 flex-1" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-3 w-40" />
                  </li>
                ))}
              </ul>
            ) : null}
          </SkeletonCard>
          <div className="space-y-4">
            <SkeletonCard className="overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-3 w-12" />
              </div>
              {nodeRows ? (
                <ul className="divide-y divide-border">
                  {skeletonKeys(nodeRows).map((index) => (
                    <li key={index} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-3 w-36" />
                      </div>
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </li>
                  ))}
                </ul>
              ) : null}
            </SkeletonCard>
            <SkeletonCard className="p-4">
              <Skeleton className="h-3 w-16" />
              <ul className="mt-3 space-y-2.5">
                {skeletonKeys(3).map((index) => (
                  <li key={index} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="size-3.5 rounded-full" />
                    </span>
                    <Skeleton className="h-3 w-12" />
                  </li>
                ))}
              </ul>
            </SkeletonCard>
          </div>
        </div>
      </SkeletonRoot>
    </AdminPage>
  );
}

function FilterBarSkeleton({ controls = 4 }: { controls?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Skeleton className="h-8 w-full sm:w-56" />
      {skeletonKeys(controls).map((index) => (
        <Skeleton key={index} className="h-8 w-[9.75rem]" />
      ))}
    </div>
  );
}

export function AdminServersPageSkeleton({ count }: { count?: number }) {
  const rows = clampSkeletonCount(count);
  return (
    <AdminPage title="Servers" actions={<ActionSkeleton className="h-10 w-32" />}>
      <SkeletonRoot className="space-y-3">
        {rows ? <FilterBarSkeleton /> : null}
        {skeletonKeys(rows).map((index) => (
          <AdminServerCardSkeleton key={index} />
        ))}
      </SkeletonRoot>
    </AdminPage>
  );
}

export function AdminNodesPageSkeleton({ count }: { count?: number }) {
  const rows = clampSkeletonCount(count, 1);
  return (
    <AdminPage title="Nodes" actions={<ActionSkeleton className="h-10 w-28" />}>
      <SkeletonRoot className="space-y-4">
        {skeletonKeys(rows).map((index) => (
          <NodeCardSkeleton key={index} />
        ))}
      </SkeletonRoot>
    </AdminPage>
  );
}

export function AdminUsersPageSkeleton({ count }: { count?: number }) {
  const rows = clampSkeletonCount(count);
  return (
    <AdminPage
      title="Users"
      description="Panel accounts that can sign in and own servers. Click a row to edit."
      actions={<ActionSkeleton className="h-10 w-28" />}
    >
      <SkeletonRoot>
        <UsersTableSkeleton rows={rows} />
      </SkeletonRoot>
    </AdminPage>
  );
}

export function AdminLocationsPageSkeleton({ count }: { count?: number }) {
  const rows = clampSkeletonCount(count, 1);
  return (
    <AdminPage title="Locations" actions={<ActionSkeleton className="h-10 w-32" />}>
      <SkeletonRoot className="space-y-4">
        {skeletonKeys(rows).map((index) => (
          <EntityCardSkeleton key={index} />
        ))}
      </SkeletonRoot>
    </AdminPage>
  );
}

export function AdminNestsPageSkeleton({ nests }: { nests?: number[] }) {
  const rows = Array.isArray(nests) ? nests.map((eggs) => clampSkeletonCount(eggs, 0)) : [3];
  return (
    <AdminPage
      title="Nests"
      description="Eggs, Docker images, and startup commands. Import a Pterodactyl or Pelican egg JSON, or create your own."
      actions={
        <div className="flex flex-wrap gap-2">
          <ActionSkeleton className="h-10 w-28" />
          <ActionSkeleton className="h-10 w-24" />
          <ActionSkeleton className="h-10 w-28" />
        </div>
      }
    >
      <SkeletonRoot className="space-y-4">
        {rows.map((eggs, index) => (
          <NestCardSkeleton key={index} eggs={eggs} />
        ))}
      </SkeletonRoot>
    </AdminPage>
  );
}

export function AdminDatabaseHostsPageSkeleton({ count }: { count?: number }) {
  const rows = clampSkeletonCount(count, 1);
  return (
    <AdminPage title="Database hosts" actions={<ActionSkeleton className="h-10 w-28" />}>
      <SkeletonRoot className="space-y-4">
        {skeletonKeys(rows).map((index) => (
          <EntityCardSkeleton key={index} />
        ))}
      </SkeletonRoot>
    </AdminPage>
  );
}

export function SettingsWorkspaceSkeleton() {
  return (
    <SkeletonRoot className="grid items-start gap-4 lg:grid-cols-[17.5rem_minmax(0,1fr)] lg:gap-6">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-1 lg:gap-1.5">
        {skeletonKeys(4).map((index) => (
          <div
            key={index}
            className="flex min-h-[4.5rem] items-start gap-3 rounded-xl border border-border bg-background/60 px-3 py-3"
          >
            <Skeleton className="mt-0.5 size-9" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        ))}
      </div>
      <SkeletonCard className="overflow-hidden">
        <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
          <Skeleton className="mt-0.5 size-9" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <div className="space-y-4 px-5 py-5 sm:px-6">
          {skeletonKeys(4).map((index) => (
            <div key={index} className="space-y-1.5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      </SkeletonCard>
    </SkeletonRoot>
  );
}

export function SettingsSkeleton() {
  return (
    <AdminPage
      className="max-w-7xl"
      title="Settings"
      description="Identity, updates, mail, and how people sign in."
    >
      <SettingsWorkspaceSkeleton />
    </AdminPage>
  );
}

export function FormSkeleton() {
  return (
    <SkeletonRoot className="grid items-start gap-4 xl:grid-cols-2">
      {skeletonKeys(2).map((section) => (
        <SkeletonCard key={section} className="p-5 sm:p-6">
          <div className="mb-5 flex items-start gap-3">
            <Skeleton className="size-9" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
          <div className="space-y-4">
            {skeletonKeys(4).map((index) => (
              <div key={index} className="space-y-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        </SkeletonCard>
      ))}
    </SkeletonRoot>
  );
}

export function AdminEditFormSkeleton({
  title,
  description,
  backHref,
  backLabel,
}: {
  title: string;
  description: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <AdminFormPage title={title} description={description} backHref={backHref} backLabel={backLabel}>
      <FormSkeleton />
    </AdminFormPage>
  );
}

export function NodeDetailSkeleton() {
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[1.4fr_1fr]">
      <div className="space-y-4">
        <SkeletonCard className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-16" />
          </div>
          <div className="mt-4 space-y-3">
            {skeletonKeys(4).map((index) => (
              <div key={index} className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="size-5 rounded-full" />
              </div>
            ))}
          </div>
        </SkeletonCard>
        <SkeletonCard className="p-5 sm:p-6">
          <Skeleton className="h-4 w-24" />
          <div className="mt-4 space-y-3">
            {skeletonKeys(4).map((index) => (
              <div key={index} className="flex items-center justify-between gap-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </SkeletonCard>
      </div>
      <SkeletonCard className="p-5 sm:p-6">
        <Skeleton className="h-4 w-24" />
        <div className="mt-5 space-y-5">
          {skeletonKeys(2).map((index) => (
            <div key={index}>
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-20" />
              </div>
              <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
            </div>
          ))}
          {skeletonKeys(2).map((index) => (
            <div key={index} className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-10" />
            </div>
          ))}
        </div>
      </SkeletonCard>
    </div>
  );
}
