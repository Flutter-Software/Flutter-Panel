"use client";

import { useRouter } from "next/navigation";
import { Plus, Shield, UserRound } from "lucide-react";
import { AdminError, AdminPage, AdminTable, ListSkeleton } from "@/components/admin-table";
import { ButtonLink } from "@/components/ui";
import { useQuery } from "@/lib/query";
import type { PublicUser } from "@flutter-software/shared";

export default function AdminUsersPage() {
  const router = useRouter();
  const { data, error } = useQuery<{ data: { users: PublicUser[] } }>("/api/v1/admin/users");
  const users = data?.data.users ?? [];

  return (
    <AdminPage
      title="Users"
      description="Panel accounts that can sign in and own servers. Click a row to edit."
      actions={
        <ButtonLink href="/admin/users/new">
          <Plus className="size-4" />
          New user
        </ButtonLink>
      }
    >
      <AdminError message={error} />
      {!data && !error ? (
        <ListSkeleton />
      ) : (
      <AdminTable
        empty="No users yet."
        onRowClick={(id) => router.push(`/admin/users/${id}`)}
        rows={users.map((user) => ({
          id: user.id,
          name: user.username,
          meta: user.email,
          status: user.role === "admin" ? "Admin" : "User",
        }))}
        statusLabel="Role"
      />
      )}
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Shield className="size-3.5" />
        Admins can manage the panel.
        <UserRound className="size-3.5" />
        Users only see their own servers.
      </p>
    </AdminPage>
  );
}
