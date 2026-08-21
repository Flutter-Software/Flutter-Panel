"use client";

import { useParams } from "next/navigation";
import { AdminError, AdminFormPage, ListSkeleton } from "@/components/admin-table";
import { useQuery } from "@/lib/query";
import { EggForm, type EggRecord } from "../../egg-form";

export default function EditEggPage() {
  const params = useParams<{ id: string }>();
  const { data, error } = useQuery<{ data: { egg: EggRecord } }>(
    `/api/v1/admin/eggs/${params.id}`,
  );
  const egg = data?.data.egg ?? null;

  if (error && !egg) {
    return (
      <AdminFormPage
        title="Egg"
        description="This egg could not be loaded."
        backHref="/admin/nests"
        backLabel="Nests"
      >
        <AdminError message={error} />
      </AdminFormPage>
    );
  }

  if (!egg) {
    return (
      <AdminFormPage
        title="Egg"
        description="Edit this egg."
        backHref="/admin/nests"
        backLabel="Nests"
      >
        <ListSkeleton rows={2} />
      </AdminFormPage>
    );
  }

  return <EggForm mode="edit" initial={egg} />;
}
