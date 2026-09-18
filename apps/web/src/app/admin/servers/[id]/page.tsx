"use client";

import { use } from "react";
import { AdminEditFormSkeleton } from "@/components/skeletons";
import { QueryErrorPage } from "@/components/error-page";
import { useQuery } from "@/lib/query";
import type { ServerRecord } from "@/lib/types";
import { ServerForm } from "../server-form";

export default function EditServerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, errorStatus, reload } = useQuery<{ data: { server: ServerRecord } }>(
    `/api/v1/admin/servers/${id}`,
  );
  const server = data?.data.server ?? null;

  if (error && !server) {
    return (
      <QueryErrorPage
        error={error}
        status={errorStatus}
        onRetry={() => void reload()}
        homeHref="/admin/servers"
        homeLabel="Back to servers"
      />
    );
  }

  if (!server) {
    return (
      <AdminEditFormSkeleton
        title="Server"
        description="Edit this server."
        backHref="/admin/servers"
        backLabel="Servers"
      />
    );
  }

  return <ServerForm mode="edit" initial={server} />;
}
