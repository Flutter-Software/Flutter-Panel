/**
 * Loading placeholders for one unit of a list. Every list in the panel is a
 * rack (DESIGN.md → Layout grammar), so each of these is a rack row: put them
 * inside a `SkeletonRack`, under a `SkeletonLegend` with the same columns.
 * The column classes mirror the live views; keep them in step when a view's
 * grid changes.
 */
import {
  Skeleton,
  SkeletonLegend,
  SkeletonMeter,
  SkeletonRack,
  SkeletonRail,
  skeletonKeys,
} from "@/components/skeleton";
import { cn } from "@/lib/cn";

/* ---- Column grids, copied from the live list views ---- */

/**
 * `SERVER_RACK_COLUMNS` from server-card.tsx. Copied rather than imported:
 * server-card is a "use client" module, and a plain string imported from one
 * into a server-rendered loading.tsx arrives as a client reference, not a string.
 */
export const SERVER_RACK_COLUMNS =
  "lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.2fr)_repeat(3,5.75rem)_7rem] lg:items-center lg:gap-5";

/** admin/servers/(list)/view.tsx */
export const ADMIN_SERVER_COLUMNS =
  "xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.8fr)_minmax(0,1.3fr)_auto] xl:gap-5";
/** admin/nodes/(list)/view.tsx */
export const NODE_COLUMNS =
  "xl:grid-cols-[minmax(0,1.5fr)_minmax(0,0.6fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_auto] xl:gap-5";
/** admin/users/(list)/view.tsx */
export const USER_COLUMNS =
  "lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,0.6fr)_minmax(0,0.5fr)_minmax(0,0.6fr)_minmax(0,0.8fr)] lg:gap-5";
/** admin/locations/(list)/view.tsx */
export const LOCATION_COLUMNS = "md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)_minmax(0,0.5fr)_auto] md:gap-5";
/** admin/database-hosts/(list)/view.tsx */
export const DATABASE_HOST_COLUMNS =
  "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.6fr)_minmax(0,1fr)_auto] lg:gap-5";
/** Egg rows inside a nest, admin/nests/(list)/view.tsx */
const EGG_COLUMNS = "sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_6.5rem_auto]";

/** One server on the home page: matches `ServerCard` (name, node, address, CPU, memory, disk, status). */
export function ServerCardSkeleton() {
  return (
    <div className={cn("relative flex flex-col gap-2 px-4 py-3.5", SERVER_RACK_COLUMNS)}>
      <SkeletonRail />
      <div className="min-w-0 space-y-1.5 pl-1">
        <Skeleton className="h-[18px] w-36" />
        <Skeleton className="h-3.5 w-20" />
      </div>
      <Skeleton className="ml-1 h-3.5 w-32 lg:ml-0" />
      <Skeleton className="ml-1 h-3.5 w-36 lg:ml-0" />
      <div className="grid grid-cols-3 gap-4 pl-1 lg:contents">
        {skeletonKeys(3).map((index) => (
          <div key={index} className="min-w-0">
            <Skeleton className="h-3.5 w-12" />
            <SkeletonMeter className="mt-1.5" />
          </div>
        ))}
      </div>
      <Skeleton className="hidden h-3.5 w-16 lg:block" />
      {/* Narrow screens put the status word top-right, next to the name. */}
      <Skeleton className="absolute right-4 top-3.5 h-3.5 w-14 lg:hidden" />
    </div>
  );
}

/** One server in Admin → Servers: name and status, node, address, owner, usage, actions. */
export function AdminServerCardSkeleton() {
  return (
    <div className={cn("relative grid gap-3 px-4 py-3.5 xl:items-center", ADMIN_SERVER_COLUMNS)}>
      <SkeletonRail />
      <div className="min-w-0 space-y-1.5 pl-1">
        <div className="flex items-center gap-3">
          <Skeleton className="h-[18px] w-40" />
          <Skeleton className="h-3.5 w-14" />
        </div>
        <Skeleton className="h-3.5 w-24" />
      </div>
      <Skeleton className="ml-1 h-3.5 w-28 xl:ml-0" />
      <Skeleton className="ml-1 h-3.5 w-36 xl:ml-0" />
      <Skeleton className="ml-1 h-3.5 w-20 xl:ml-0" />
      <div className="ml-1 space-y-1.5 xl:ml-0">
        <Skeleton className="h-3.5 w-32" />
        <SkeletonMeter className="max-w-[12rem]" />
      </div>
      <div className="flex items-center gap-2 pl-1 xl:w-[9.5rem] xl:justify-end xl:pl-0">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="size-8" />
      </div>
    </div>
  );
}

/** One node in Admin → Nodes: name and state, location, memory allocated, daemon token, actions. */
export function NodeCardSkeleton() {
  return (
    <div className={cn("relative grid gap-3 px-4 py-3.5 xl:items-start", NODE_COLUMNS)}>
      <SkeletonRail />
      <div className="min-w-0 space-y-1.5 pl-1">
        <div className="flex items-center gap-3">
          <Skeleton className="h-[18px] w-32" />
          <Skeleton className="h-3.5 w-14" />
        </div>
        <Skeleton className="h-3.5 w-44" />
      </div>
      <Skeleton className="ml-1 h-3.5 w-20 xl:ml-0" />
      <div className="ml-1 space-y-1.5 xl:ml-0">
        <Skeleton className="h-3.5 w-28" />
        <SkeletonMeter className="max-w-[12rem]" />
      </div>
      <Skeleton className="ml-1 h-8 w-28 xl:ml-0" />
      <div className="flex items-center gap-2 pl-1 xl:pl-0">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="size-8" />
      </div>
    </div>
  );
}

/**
 * A plain entity row (no status): name, description or address, a count, actions.
 * Defaults to the Locations grid; pass `columns` for Database hosts.
 */
export function EntityCardSkeleton({
  columns = LOCATION_COLUMNS,
  cells = 2,
}: {
  columns?: string;
  /** Text cells between the name and the actions. */
  cells?: number;
} = {}) {
  return (
    <div className={cn("grid gap-2 px-4 py-3 sm:grid-cols-2 md:items-center", columns)}>
      <Skeleton className="h-4 w-24" />
      {skeletonKeys(cells).map((index) => (
        <Skeleton key={index} className={cn("h-3.5", index === 0 ? "w-48 max-w-full" : "w-10")} />
      ))}
      <div className="flex items-center gap-2 sm:justify-end">
        <Skeleton className="h-8 w-14" />
        <Skeleton className="size-8" />
      </div>
    </div>
  );
}

/** One nest in Admin → Nests: its heading, description and actions, then its eggs as a rack. */
export function NestCardSkeleton({ eggs = 0 }: { eggs?: number }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-3.5 w-72 max-w-full" />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="size-8" />
        </div>
      </div>
      {eggs > 0 ? (
        <SkeletonRack>
          {skeletonKeys(eggs).map((index) => (
            <div key={index} className={cn("grid gap-x-5 gap-y-2 px-4 py-3 sm:items-center", EGG_COLUMNS)}>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3.5 w-56 max-w-full" />
              <Skeleton className="h-3.5 w-16" />
              <div className="flex items-center gap-1">
                <Skeleton className="h-8 w-14" />
                <Skeleton className="size-8" />
              </div>
            </div>
          ))}
        </SkeletonRack>
      ) : null}
    </section>
  );
}

/** Admin → Users: the column legend and a rack of user rows. */
export function UsersTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div>
      <SkeletonLegend
        columns={cn("lg:grid", USER_COLUMNS)}
        labels={["User", "Email", "Role", "Servers", "Two-factor", "Created"]}
      />
      <SkeletonRack>
        {skeletonKeys(rows).map((index) => (
          <div
            key={index}
            className={cn("grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-4 lg:items-center", USER_COLUMNS)}
          >
            <div className="col-span-2 flex items-center gap-3 sm:col-span-4 lg:col-span-1">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="col-span-2 h-3.5 w-40 lg:col-span-1" />
            <Skeleton className="h-3.5 w-12" />
            <Skeleton className="h-3.5 w-6" />
            <Skeleton className="h-3.5 w-8" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        ))}
      </SkeletonRack>
    </div>
  );
}
