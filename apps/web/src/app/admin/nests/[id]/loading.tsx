import { AdminEditFormSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <AdminEditFormSkeleton
      title="Nest"
      description="Edit this nest."
      backHref="/admin/nests"
      backLabel="Nests"
    />
  );
}
