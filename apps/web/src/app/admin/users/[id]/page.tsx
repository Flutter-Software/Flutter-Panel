"use client";

import { useParams } from "next/navigation";
import { AdminError, AdminFormPage, ListSkeleton } from "@/components/admin-table";
import { useQuery } from "@/lib/query";
import type { PublicUser } from "@flutter-software/shared";
import { UserForm } from "../user-form";

export default function EditUserPage() {
  const params = useParams<{ id: string }>();
  const { data, error } = useQuery<{ data: { user: PublicUser } }>(
    `/api/v1/admin/users/${params.id}`,
  );
  const user = data?.data.user ?? null;

  if (error && !user) {
    return (
      <AdminFormPage
        title="User"
        description="This account could not be loaded."
        backHref="/admin/users"
        backLabel="Users"
      >
        <AdminError message={error} />
      </AdminFormPage>
    );
  }

  if (!user) {
    return (
      <AdminFormPage
        title="User"
        description="Edit this account."
        backHref="/admin/users"
        backLabel="Users"
      >
        <ListSkeleton rows={2} />
      </AdminFormPage>
    );
  }

  return <UserForm mode="edit" initial={user} />;
}
