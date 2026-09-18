import { AdminEditFormSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <AdminEditFormSkeleton
      title="Database host"
      description="Edit this database host."
      backHref="/admin/database-hosts"
      backLabel="Databases"
    />
  );
}
