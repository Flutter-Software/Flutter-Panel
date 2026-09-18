import { DashboardSkeleton } from "@/components/skeletons";
import { skeletonCounts } from "@/lib/skeleton-counts-server";

export default async function Loading() {
  const counts = await skeletonCounts();
  return <DashboardSkeleton servers={counts.adminServers} nodes={counts.adminNodes} />;
}
