import AdminDashboardPage from "./view";
import { skeletonCounts } from "@/lib/skeleton-counts-server";

export default async function Page() {
  const counts = await skeletonCounts();
  return (
    <AdminDashboardPage skeletonServers={counts.adminServers} skeletonNodes={counts.adminNodes} />
  );
}
