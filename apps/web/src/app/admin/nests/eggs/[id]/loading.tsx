import { AdminEditFormSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <AdminEditFormSkeleton
      title="Egg"
      description="Edit this egg."
      backHref="/admin/nests"
      backLabel="Nests"
    />
  );
}
