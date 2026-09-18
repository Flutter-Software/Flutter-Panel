import { cookies } from "next/headers";
import { parseSkeletonCounts, SKELETON_COUNTS_COOKIE, type SkeletonCounts } from "@/lib/skeleton-counts";

export async function skeletonCounts(): Promise<SkeletonCounts> {
  const jar = await cookies();
  return parseSkeletonCounts(jar.get(SKELETON_COUNTS_COOKIE)?.value);
}
