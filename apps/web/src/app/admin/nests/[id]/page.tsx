"use client";

import { useParams } from "next/navigation";
import { AdminError, AdminFormPage, ListSkeleton } from "@/components/admin-table";
import { useQuery } from "@/lib/query";
import { NestForm, type NestRecord } from "../nest-form";

export default function EditNestPage() {
  const params = useParams<{ id: string }>();
  const { data, error } = useQuery<{ data: { nest: NestRecord } }>(
    `/api/v1/admin/nests/${params.id}`,
  );
  const nest = data?.data.nest ?? null;

  if (error && !nest) {
    return (
      <AdminFormPage
        title="Nest"
        description="This nest could not be loaded."
        backHref="/admin/nests"
        backLabel="Nests"
      >
        <AdminError message={error} />
      </AdminFormPage>
    );
  }

  if (!nest) {
    return (
      <AdminFormPage
        title="Nest"
        description="Edit this nest."
        backHref="/admin/nests"
        backLabel="Nests"
      >
        <ListSkeleton rows={2} />
      </AdminFormPage>
    );
  }

  return <NestForm mode="edit" initial={nest} />;
}
