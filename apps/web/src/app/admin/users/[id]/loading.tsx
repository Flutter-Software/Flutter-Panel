import { AdminEditFormSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <AdminEditFormSkeleton
      title="User"
      description="Edit this account."
      backHref="/admin/users"
      backLabel="Users"
    />
  );
}
