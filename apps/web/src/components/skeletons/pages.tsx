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

/** Shared with the live Overview page so the header text never flickers on load. */
export const OVERVIEW_DESCRIPTION = "Manage your users, infrastructure, servers, and panel settings.";

/**
 * Admin Overview skeleton: version banner, project link row, 3×3 section
 * grid, then the attention/services pair, matching `admin/(dashboard)/view.tsx`.
 */
export function DashboardSkeleton() {
  return (
    <AdminPage title="Overview" description={OVERVIEW_DESCRIPTION}>
      <SkeletonRoot className="space-y-6">
        <SkeletonCard className="flex items-center gap-3 border-l-4 px-4 py-3.5">
          <Skeleton className="size-5 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3.5 w-64" />
          </div>
        </SkeletonCard>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {skeletonKeys(4).map((index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {skeletonKeys(9).map((index) => (
            <SkeletonCard key={index} className="space-y-2.5 p-5">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-7" />
              </div>
              <Skeleton className="h-3.5 w-full max-w-60" />
              <Skeleton className="h-3 w-20" />
            </SkeletonCard>
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {skeletonKeys(2).map((index) => (
            <SkeletonCard key={index} className="p-4">
              <Skeleton className="h-3 w-24" />
              <ul className="mt-3 space-y-2.5">
                {skeletonKeys(3).map((row) => (
                  <li key={row} className="flex items-center justify-between gap-3">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-12" />
                  </li>
                ))}
              </ul>
            </SkeletonCard>
          ))}
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

/** Matches app/admin/settings/workspace.tsx: grouped nav on the left, header + cards on the right. */
export function SettingsWorkspaceSkeleton() {
  return (
    <SkeletonRoot className="grid items-start gap-6 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-10">
      <div className="flex gap-1 overflow-hidden lg:flex-col lg:gap-5">
        {[1, 2, 2].map((count, group) => (
          <div key={group} className="flex shrink-0 gap-1 lg:flex-col lg:gap-1">
            <Skeleton className="mx-3 mb-1 hidden h-3 w-20 lg:block" />
            {skeletonKeys(count).map((index) => (
              <div key={index} className="flex items-center gap-2.5 px-3 py-2">
                <Skeleton className="size-4" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="min-w-0 space-y-5">
        <div className="space-y-1.5">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        {skeletonKeys(3).map((index) => (
          <SkeletonCard key={index} className="space-y-4 px-5 py-5 sm:px-6">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
            <Skeleton className="h-9 w-full" />
          </SkeletonCard>
        ))}
      </div>
    </SkeletonRoot>
  );
}

export function SettingsSkeleton() {
  return (
    <AdminPage
      className="max-w-6xl"
      title="Settings"
      description="Manage your panel's identity, sign-in, email delivery, and updates."
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

/** Admin → Extensions: header actions, folder hint, then a few extension rows. */
export function AdminExtensionsPageSkeleton() {
  return (
    <AdminPage
      title="Extensions"
      description="Add pages and tools to servers. Extensions run sandboxed and only get the permissions you approve."
      actions={<ActionSkeleton className="h-10 w-28" />}
    >
      <SkeletonRoot className="space-y-6">
        <SkeletonCard className="p-4">
          <Skeleton className="h-4 w-full max-w-lg" />
        </SkeletonCard>
        <SkeletonCard className="divide-y divide-border overflow-hidden">
          {skeletonKeys(3).map((index) => (
            <div key={index} className="flex items-start justify-between gap-3 px-5 py-4">
              <div className="flex min-w-0 flex-1 gap-3">
                <Skeleton className="size-10 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-72" />
                  <Skeleton className="h-4 w-40" />
                </div>
              </div>
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </SkeletonCard>
      </SkeletonRoot>
    </AdminPage>
  );
}

/** Admin → API Keys: header action, usage hint, then a few key rows. */
export function AdminApiKeysPageSkeleton() {
  return (
    <AdminPage
      title="API Keys"
      description="Application keys give scripts, bots, and billing systems full or scoped access to the admin API."
      actions={<ActionSkeleton className="h-10 w-32" />}
    >
      <SkeletonRoot className="space-y-6">
        <SkeletonCard className="p-4">
          <Skeleton className="h-4 w-full max-w-md" />
        </SkeletonCard>
        <SkeletonCard className="divide-y divide-border overflow-hidden">
          {skeletonKeys(3).map((index) => (
            <div key={index} className="flex items-start justify-between gap-3 px-5 py-4">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-64" />
              </div>
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </SkeletonCard>
      </SkeletonRoot>
    </AdminPage>
  );
}
