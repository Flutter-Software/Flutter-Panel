import AdminNestsPage from "./view";
import { skeletonCounts } from "@/lib/skeleton-counts-server";

export default async function Page() {
  const counts = await skeletonCounts();
  return <AdminNestsPage skeletonNests={counts.adminNests} />;
}
