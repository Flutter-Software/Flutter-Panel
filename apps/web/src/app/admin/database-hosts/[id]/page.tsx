"use client";

import { use } from "react";
import { AdminFormPage, ListSkeleton } from "@/components/admin-table";
import { QueryErrorPage } from "@/components/error-page";
import { useQuery } from "@/lib/query";
import { DatabaseHostForm } from "../host-form";
import type { DatabaseHostRecord } from "../types";

export default function EditDatabaseHostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, errorStatus, reload } = useQuery<{ data: { host: DatabaseHostRecord } }>(
    `/api/v1/admin/database-hosts/${id}`,
  );
  const host = data?.data.host ?? null;

  if (error && !host) {
    return (
      <QueryErrorPage
        error={error}
        status={errorStatus}
        onRetry={() => void reload()}
        homeHref="/admin/database-hosts"
        homeLabel="Back to database hosts"
      />
    );
  }

  if (!host) {
    return (
      <AdminFormPage
        title="Database host"
        description="Edit this database host."
        backHref="/admin/database-hosts"
        backLabel="Databases"
      >
        <ListSkeleton rows={2} />
      </AdminFormPage>
    );
  }

  return <DatabaseHostForm mode="edit" initial={host} />;
}
