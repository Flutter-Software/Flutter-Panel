"use client";

import { use } from "react";
import { AdminEditFormSkeleton } from "@/components/skeletons";
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
      <AdminEditFormSkeleton
        title="Database host"
        description="Edit this database host."
        backHref="/admin/database-hosts"
        backLabel="Databases"
      />
    );
  }

  return <DatabaseHostForm mode="edit" initial={host} />;
}
