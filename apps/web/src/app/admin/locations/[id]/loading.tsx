import { AdminEditFormSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <AdminEditFormSkeleton
      title="Location"
      description="Edit this location."
      backHref="/admin/locations"
      backLabel="Locations"
    />
  );
}
