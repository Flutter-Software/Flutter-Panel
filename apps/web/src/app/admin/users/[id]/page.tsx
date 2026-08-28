"use client";

import { use } from "react";
import { AdminFormPage, ListSkeleton } from "@/components/admin-table";
import { QueryErrorPage } from "@/components/error-page";
import { useQuery } from "@/lib/query";
import type { PublicUser } from "@flutter-software/shared";
import { UserForm } from "../user-form";

export default function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, errorStatus, reload } = useQuery<{ data: { user: PublicUser } }>(
    `/api/v1/admin/users/${id}`,
  );
  const user = data?.data.user ?? null;

  if (error && !user) {
    return (
      <QueryErrorPage
        error={error}
        status={errorStatus}
        onRetry={() => void reload()}
        homeHref="/admin/users"
        homeLabel="Back to users"
      />
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
