import { Skeleton, SkeletonCard, skeletonKeys } from "@/components/skeleton";

export function ServerCardSkeleton() {
  return (
    <SkeletonCard className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-[15px] w-40" />
          <Skeleton className="h-4 w-28" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <dl className="mt-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      </dl>
      <div className="mt-4 grid grid-cols-3 gap-4 border-t border-border pt-4">
        {skeletonKeys(3).map((index) => (
          <div key={index}>
            <div className="flex items-baseline justify-between gap-1">
              <Skeleton className="h-3 w-8" />
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className="mt-1.5 h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>
    </SkeletonCard>
  );
}

export function AdminServerCardSkeleton() {
  return (
    <SkeletonCard className="p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-7 w-16" />
          </div>
          <Skeleton className="mt-2 h-4 w-28" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="size-8" />
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {skeletonKeys(5).map((index) => (
          <div key={index}>
            <Skeleton className="h-3 w-12" />
            <Skeleton className="mt-1 h-4 w-24" />
          </div>
        ))}
      </div>
    </SkeletonCard>
  );
}

export function NodeCardSkeleton() {
  return (
    <SkeletonCard className="p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-5 w-16" />
          </div>
          <Skeleton className="mt-2 h-3.5 w-48" />
          <Skeleton className="mt-1 h-3 w-40" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="size-8" />
        </div>
      </div>
      <div className="mt-5 grid gap-5 sm:grid-cols-2 sm:items-end">
        <div>
          <Skeleton className="h-3 w-28" />
          <div className="mt-2 flex items-center gap-3">
            <Skeleton className="h-1.5 min-w-0 flex-1 rounded-full" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
        <div>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-4 w-36" />
        </div>
      </div>
      <div className="mt-5">
        <Skeleton className="h-3 w-28" />
        <div className="mt-2 flex flex-wrap gap-2">
          {skeletonKeys(4).map((index) => (
            <Skeleton key={index} className="h-7 w-28" />
          ))}
        </div>
      </div>
    </SkeletonCard>
  );
}

export function EntityCardSkeleton() {
  return (
    <SkeletonCard className="p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-16" />
          </div>
          <Skeleton className="mt-2 h-4 w-56" />
          <Skeleton className="mt-1 h-3.5 w-40" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="size-8" />
        </div>
      </div>
    </SkeletonCard>
  );
}

export function NestCardSkeleton({ eggs = 0 }: { eggs?: number }) {
  return (
    <SkeletonCard className="p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-5 w-14" />
          </div>
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Skeleton className="h-8 w-14" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="size-8" />
        </div>
      </div>
      {eggs > 0 ? (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
          {skeletonKeys(eggs).map((index) => (
            <li key={index} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Skeleton className="h-8 w-14" />
                <Skeleton className="size-8" />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </SkeletonCard>
  );
}

export function UsersTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <SkeletonCard className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">User</th>
              <th className="px-4 py-2.5 font-medium">Email</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Servers</th>
              <th className="px-4 py-2.5 font-medium">2FA</th>
              <th className="px-4 py-2.5 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {skeletonKeys(rows).map((index) => (
              <tr key={index} className="border-t border-border">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-8 rounded-full" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-40" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-5 w-16 rounded-full" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-8" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-8" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-20" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SkeletonCard>
  );
}
