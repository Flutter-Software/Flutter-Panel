import { AdminEditFormSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <AdminEditFormSkeleton
      title="Server"
      description="Edit this server."
      backHref="/admin/servers"
      backLabel="Servers"
    />
  );
}
