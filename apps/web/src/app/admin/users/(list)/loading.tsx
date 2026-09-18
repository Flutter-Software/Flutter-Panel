import { AdminUsersPageSkeleton } from "@/components/skeletons";
import { skeletonCounts } from "@/lib/skeleton-counts-server";

export default async function Loading() {
  const counts = await skeletonCounts();
  return <AdminUsersPageSkeleton count={counts.adminUsers} />;
}
