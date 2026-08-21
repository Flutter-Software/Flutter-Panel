"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AdminFormPage, ListSkeleton } from "@/components/admin-table";
import { EggForm } from "../../egg-form";

function CreateEggInner() {
  const search = useSearchParams();
  return <EggForm mode="create" defaultNestId={search.get("nestId") ?? undefined} />;
}

export default function CreateEggPage() {
  return (
    <Suspense
      fallback={
        <AdminFormPage
          title="New egg"
          description="Create an egg in a nest."
          backHref="/admin/nests"
          backLabel="Nests"
        >
          <ListSkeleton rows={2} />
        </AdminFormPage>
      }
    >
      <CreateEggInner />
    </Suspense>
  );
}
