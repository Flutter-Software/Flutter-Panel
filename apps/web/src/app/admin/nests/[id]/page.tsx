"use client";

import { use } from "react";
import { AdminFormPage, ListSkeleton } from "@/components/admin-table";
import { QueryErrorPage } from "@/components/error-page";
import { useQuery } from "@/lib/query";
import { NestForm, type NestRecord } from "../nest-form";

export default function EditNestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, errorStatus, reload } = useQuery<{ data: { nest: NestRecord } }>(
    `/api/v1/admin/nests/${id}`,
  );
  const nest = data?.data.nest ?? null;

  if (error && !nest) {
    return (
      <QueryErrorPage
        error={error}
        status={errorStatus}
        onRetry={() => void reload()}
        homeHref="/admin/nests"
        homeLabel="Back to nests"
      />
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
