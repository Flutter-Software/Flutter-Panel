"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AdminEditFormSkeleton } from "@/components/skeletons";
import { EggForm } from "../../egg-form";

function CreateEggInner() {
  const search = useSearchParams();
  return <EggForm mode="create" defaultNestId={search.get("nestId") ?? undefined} />;
}

export default function CreateEggPage() {
  return (
    <Suspense
      fallback={
        <AdminEditFormSkeleton
          title="New egg"
          description="Create an egg in a nest."
          backHref="/admin/nests"
          backLabel="Nests"
        />
      }
    >
      <CreateEggInner />
    </Suspense>
  );
}
