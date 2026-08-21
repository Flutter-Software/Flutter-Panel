"use client";

import { useParams } from "next/navigation";
import { AdminError, AdminFormPage, ListSkeleton } from "@/components/admin-table";
import { useQuery } from "@/lib/query";
import type { ServerRecord } from "@/lib/types";
import { ServerForm } from "../server-form";

export default function EditServerPage() {
  const params = useParams<{ id: string }>();
  const { data, error } = useQuery<{ data: { server: ServerRecord } }>(
    `/api/v1/admin/servers/${params.id}`,
  );
  const server = data?.data.server ?? null;

  if (error && !server) {
    return (
      <AdminFormPage
        title="Server"
        description="This server could not be loaded."
        backHref="/admin/servers"
        backLabel="Servers"
      >
        <AdminError message={error} />
      </AdminFormPage>
    );
  }

  if (!server) {
    return (
      <AdminFormPage
        title="Server"
        description="Edit this server."
        backHref="/admin/servers"
        backLabel="Servers"
      >
        <ListSkeleton rows={2} />
      </AdminFormPage>
    );
  }

  return <ServerForm mode="edit" initial={server} />;
}
