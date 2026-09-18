import { SkeletonRoot } from "@/components/skeleton";
import { NodeDetailSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonRoot>
      <NodeDetailSkeleton />
    </SkeletonRoot>
  );
}
