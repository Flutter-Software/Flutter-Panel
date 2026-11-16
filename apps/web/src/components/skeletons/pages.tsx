/**
 * Page-level loading skeletons. Each mirrors the live page's layout (DESIGN.md
 * → Layout grammar): racks for lists, a readout strip and wells for live data,
 * panels for forms. Static text that won't change once data arrives (titles,
 * section headings, column legends) is rendered as real text so it doesn't
 * flicker when the page swaps in.
 */
import { AdminFormPage, AdminPage } from "@/components/admin-table";
import {
  Skeleton,
  SkeletonCard,
  SkeletonLegend,
  SkeletonMeter,
  SkeletonRack,
  SkeletonRoot,
  SkeletonWell,
  skeletonKeys,
} from "@/components/skeleton";
import { clampSkeletonCount } from "@/lib/skeleton-counts";
import { cn } from "@/lib/cn";
import {
  ADMIN_SERVER_COLUMNS,
  AdminServerCardSkeleton,
  DATABASE_HOST_COLUMNS,
  EntityCardSkeleton,
  LOCATION_COLUMNS,
  NestCardSkeleton,
  NODE_COLUMNS,
  NodeCardSkeleton,
  SERVER_RACK_COLUMNS,
  ServerCardSkeleton,
  UsersTableSkeleton,
} from "@/components/skeletons/items";

function ActionSkeleton({ className = "h-9 w-28" }: { className?: string }) {
  return <Skeleton className={className} />;
}

/**
 * Home page (Servers): title, one summary sentence, the filter, underline tabs,
 * the column legend and a rack of server rows. Mirrors `(app)/(home)/view.tsx`.
 */
export function HomeServersSkeleton({ count }: { count?: number }) {
  const rows = clampSkeletonCount(count);
  return (
    <SkeletonRoot className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="text-[31px] font-semibold">Servers</h1>
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-full sm:w-64" />
      </div>

      <div aria-hidden className="flex gap-6 border-b border-border">
        <span className="-mb-px inline-flex items-center gap-2 border-b-2 border-primary pb-2 text-sm font-medium">
          My servers
          <Skeleton className="h-3.5 w-4" />
        </span>
        <span className="-mb-px inline-flex items-center gap-2 border-b-2 border-transparent pb-2 text-sm text-muted-foreground">
          Shared with me
          <Skeleton className="h-3.5 w-4" />
        </span>
      </div>

      {rows ? (
        <div>
          <SkeletonLegend
            columns={SERVER_RACK_COLUMNS}
            labels={["Server", "Node", "Address", "CPU", "Memory", "Disk", "Status"]}
          />
          <SkeletonRack>
            {skeletonKeys(rows).map((index) => (
              <ServerCardSkeleton key={index} />
            ))}
          </SkeletonRack>
        </div>
      ) : null}
    </SkeletonRoot>
  );
}

/** Ragged line lengths (%) so the console placeholder reads as log output, not a grid. */
const CONSOLE_LINE_WIDTHS = [64, 48, 72, 40, 56, 68, 36, 60, 52, 44];

/**
 * Server console page: the readout strip (address, uptime, CPU, memory, disk),
 * the console well, then the three history graphs in one well. Mirrors
 * `server/[id]/console/page.tsx`. Not wired to a loading.tsx yet.
 */
export function ServerConsoleSkeleton() {
  return (
    <SkeletonRoot className="space-y-4">
      <SkeletonWell className="grid overflow-hidden [grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr))] [&>*]:-mb-px [&>*]:-mr-px [&>*]:border-b [&>*]:border-r [&>*]:border-border">
        {["Address", "Uptime", "CPU", "Memory", "Disk"].map((label, index) => (
          <div key={label} className="relative min-w-0 px-4 pb-3.5 pt-3">
            <p className="text-[13px] text-muted-foreground">{label}</p>
            <Skeleton className={cn("mt-2 h-6", index === 0 ? "w-36" : "w-20")} />
            {index >= 2 ? <SkeletonMeter className="absolute inset-x-0 bottom-0" /> : null}
          </div>
        ))}
      </SkeletonWell>

      <SkeletonWell className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
          <h2 className="text-[16px] font-semibold">Console</h2>
          <Skeleton className="h-7 w-36" />
        </div>
        <div className="h-[32rem] space-y-2.5 overflow-hidden bg-background p-4">
          {CONSOLE_LINE_WIDTHS.map((width, index) => (
            <div key={index} style={{ width: `${width}%` }}>
              <Skeleton className="h-3.5" />
            </div>
          ))}
        </div>
        <div className="flex h-11 items-center gap-3 border-t border-border px-3">
          <Skeleton className="size-4" />
          <Skeleton className="h-3.5 w-48" />
        </div>
      </SkeletonWell>

      <SkeletonWell className="grid divide-y divide-border overflow-hidden sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {["CPU", "Memory", "Network"].map((label) => (
          <div key={label} className="space-y-2 p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[13px] text-muted-foreground">{label}</p>
                <Skeleton className="mt-1 h-4 w-24" />
              </div>
              <p className="text-[12px] text-muted-foreground">Last minute</p>
            </div>
            <Skeleton className="h-24 w-full" />
          </div>
        ))}
      </SkeletonWell>
    </SkeletonRoot>
  );
}

/** Shared with the live Overview page so the header text never flickers on load. */
export const OVERVIEW_DESCRIPTION = "Manage your users, infrastructure, servers, and panel settings.";

/**
 * Admin Overview: version note, then "Needs attention" and the "Manage" rack in
 * the main column, with Services (a well) and Resources (links) beside it.
 * Mirrors `admin/(dashboard)/view.tsx`.
 */
export function DashboardSkeleton() {
  return (
    <AdminPage title="Overview" description={OVERVIEW_DESCRIPTION}>
      <SkeletonRoot className="space-y-6">
        <div className="space-y-1.5 border-l-2 border-border py-0.5 pl-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3.5 w-72 max-w-full" />
        </div>

        <div className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0 space-y-8">
            <section className="space-y-3">
              <h2 className="text-[20px] font-semibold">Needs attention</h2>
              <div className="flex items-center gap-2.5">
                <span className="size-2 shrink-0 rounded-full bg-border" aria-hidden />
                <Skeleton className="h-4 w-80 max-w-full" />
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-[20px] font-semibold">Manage</h2>
              <SkeletonRack>
                {skeletonKeys(10).map((index) => (
                  <div key={index} className="flex items-center gap-4 px-4 py-3">
                    <Skeleton className="size-[18px] shrink-0" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-[17px] w-28" />
                      <Skeleton className="h-3.5 w-full max-w-80" />
                    </div>
                    {/* The last two areas (settings panes) have no count. */}
                    {index < 8 ? <Skeleton className="h-5 w-6 shrink-0" /> : null}
                  </div>
                ))}
              </SkeletonRack>
            </section>
          </div>

          <aside className="space-y-8">
            <section className="space-y-3">
              <h2 className="text-[20px] font-semibold">Services</h2>
              <SkeletonWell className="px-4 py-3">
                <ul className="space-y-2.5">
                  {skeletonKeys(3).map((row) => (
                    <li key={row} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2.5">
                        <span className="size-2 shrink-0 rounded-full bg-border" aria-hidden />
                        <Skeleton className="h-4 w-20" />
                      </span>
                      <Skeleton className="h-3.5 w-10" />
                    </li>
                  ))}
                </ul>
              </SkeletonWell>
            </section>
            <section className="space-y-3">
              <h2 className="text-[20px] font-semibold">Resources</h2>
              <ul className="space-y-1">
                {skeletonKeys(4).map((row) => (
                  <li key={row} className="flex items-center gap-2.5 py-1.5">
                    <Skeleton className="size-4 shrink-0" />
                    <Skeleton className="h-4 w-28" />
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </SkeletonRoot>
    </AdminPage>
  );
}

/** Search box plus compact filter selects, as on Admin → Servers. */
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
    <AdminPage title="Servers" actions={<ActionSkeleton className="h-9 w-32" />}>
      <SkeletonRoot className="space-y-3">
        {rows ? (
          <>
            <FilterBarSkeleton />
            <div>
              <SkeletonLegend
                columns={cn("xl:grid", ADMIN_SERVER_COLUMNS)}
                labels={["Server", "Node", "Address", "Owner", "Usage and limits", ""]}
              />
              <SkeletonRack>
                {skeletonKeys(rows).map((index) => (
                  <AdminServerCardSkeleton key={index} />
                ))}
              </SkeletonRack>
            </div>
          </>
        ) : null}
      </SkeletonRoot>
    </AdminPage>
  );
}

export function AdminNodesPageSkeleton({ count }: { count?: number }) {
  const rows = clampSkeletonCount(count, 1);
  return (
    <AdminPage title="Nodes" actions={<ActionSkeleton />}>
      <SkeletonRoot>
        <SkeletonLegend
          columns={cn("xl:grid", NODE_COLUMNS)}
          labels={["Node", "Location", "Memory allocated", "Daemon token", ""]}
        />
        <SkeletonRack>
          {skeletonKeys(rows).map((index) => (
            <NodeCardSkeleton key={index} />
          ))}
        </SkeletonRack>
      </SkeletonRoot>
    </AdminPage>
  );
}

export function AdminUsersPageSkeleton({ count }: { count?: number }) {
  const rows = clampSkeletonCount(count);
  return (
    <AdminPage
      title="Users"
      description="Accounts that can sign in and own servers. Select a user to edit them."
      actions={<ActionSkeleton />}
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
    <AdminPage title="Locations" actions={<ActionSkeleton className="h-9 w-32" />}>
      <SkeletonRoot>
        <SkeletonLegend
          columns={cn("md:grid", LOCATION_COLUMNS)}
          labels={["Short code", "Description", "Nodes", ""]}
        />
        <SkeletonRack>
          {skeletonKeys(rows).map((index) => (
            <EntityCardSkeleton key={index} />
          ))}
        </SkeletonRack>
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
          <ActionSkeleton className="h-9 w-28" />
          <ActionSkeleton className="h-9 w-24" />
          <ActionSkeleton className="h-9 w-28" />
        </div>
      }
    >
      <SkeletonRoot className="space-y-8">
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
    <AdminPage title="Database hosts" actions={<ActionSkeleton />}>
      <SkeletonRoot>
        <SkeletonLegend
          columns={cn("lg:grid", DATABASE_HOST_COLUMNS)}
          labels={["Host", "Address", "Databases", "Nodes", ""]}
        />
        <SkeletonRack>
          {skeletonKeys(rows).map((index) => (
            <EntityCardSkeleton key={index} columns={DATABASE_HOST_COLUMNS} cells={3} />
          ))}
        </SkeletonRack>
      </SkeletonRoot>
    </AdminPage>
  );
}

/** Matches app/admin/settings/workspace.tsx: tab bar, section header, then cards of label/field rows. */
export function SettingsWorkspaceSkeleton() {
  return (
    <SkeletonRoot className="space-y-6">
      <div className="flex gap-6 overflow-hidden border-b border-border pb-2.5">
        {skeletonKeys(5).map((index) => (
          <Skeleton key={index} className="h-4 w-20 shrink-0" />
        ))}
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <SkeletonCard className="divide-y divide-border">
        {skeletonKeys(3).map((index) => (
          <div key={index} className="grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-8">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-44 max-w-full" />
            </div>
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </SkeletonCard>
    </SkeletonRoot>
  );
}

export function SettingsSkeleton() {
  return (
    <AdminPage
      className="max-w-5xl"
      title="Settings"
      description="Configure how your panel looks, signs people in, sends email and updates."
    >
      <SettingsWorkspaceSkeleton />
    </AdminPage>
  );
}

/** Admin edit forms: two panels of labelled fields. */
export function FormSkeleton() {
  return (
    <SkeletonRoot className="grid items-start gap-4 xl:grid-cols-2">
      {skeletonKeys(2).map((section) => (
        <SkeletonCard key={section} className="divide-y divide-border">
          <div className="space-y-1.5 px-4 py-3 sm:px-5">
            <Skeleton className="h-[18px] w-32" />
            <Skeleton className="h-3.5 w-56 max-w-full" />
          </div>
          <div className="space-y-4 px-4 py-4 sm:px-5">
            {skeletonKeys(4).map((index) => (
              <div key={index} className="space-y-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9 w-full" />
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
                <Skeleton className="h-5 w-9 rounded-full" />
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
              <SkeletonMeter className="mt-2" />
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

/** Admin → Extensions: header action, a hint line, then a rack of extension rows. */
export function AdminExtensionsPageSkeleton() {
  return (
    <AdminPage
      title="Extensions"
      description="Add pages and tools to servers. Extensions run sandboxed and only get the permissions you approve."
      actions={<ActionSkeleton />}
    >
      <SkeletonRoot className="space-y-4">
        <Skeleton className="h-4 w-full max-w-lg" />
        <SkeletonRack>
          {skeletonKeys(3).map((index) => (
            <div key={index} className="relative flex items-start justify-between gap-3 px-4 py-3.5">
              <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-border" />
              <div className="min-w-0 flex-1 space-y-2 pl-1">
                <Skeleton className="h-[18px] w-44" />
                <Skeleton className="h-3.5 w-72 max-w-full" />
                <Skeleton className="h-3.5 w-40" />
              </div>
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </SkeletonRack>
      </SkeletonRoot>
    </AdminPage>
  );
}

/** Admin → API keys: header action, a hint line, then a rack of key rows. */
export function AdminApiKeysPageSkeleton() {
  return (
    <AdminPage
      title="API keys"
      description="Application keys give scripts, bots and billing systems full or limited access to the admin API."
      actions={<ActionSkeleton className="h-9 w-32" />}
    >
      <SkeletonRoot className="space-y-4">
        <Skeleton className="h-4 w-full max-w-md" />
        <SkeletonRack>
          {skeletonKeys(3).map((index) => (
            <div key={index} className="flex items-start justify-between gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-[17px] w-40" />
                  <Skeleton className="h-3.5 w-24" />
                </div>
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-64 max-w-full" />
              </div>
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </SkeletonRack>
      </SkeletonRoot>
    </AdminPage>
  );
}
