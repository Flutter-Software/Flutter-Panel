"use client";

import { useRouter } from "next/navigation";
import { Plus, Shield, UserRound } from "lucide-react";
import { AdminError, AdminPage, ListSkeleton } from "@/components/admin-table";
import { useAuth } from "@/components/auth-provider";
import { ButtonLink, Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { prefetchQuery, useQuery } from "@/lib/query";
import type { ServerRecord } from "@/lib/types";
import type { PublicUser } from "@flutter-software/shared";

export default function AdminUsersPage() {
  const router = useRouter();
  const { user: viewer } = useAuth();
  const { data, error } = useQuery<{ data: { users: PublicUser[] } }>("/api/v1/admin/users");
  const servers = useQuery<{ data: { servers: ServerRecord[] } }>("/api/v1/admin/servers");
  const users = data?.data.users ?? [];
  const ownedBy = (userId: string) =>
    (servers.data?.data.servers ?? []).filter((server) => server.ownerId === userId).length;

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
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">User</th>
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="px-4 py-2.5 font-medium">Servers</th>
                  <th className="px-4 py-2.5 font-medium">2FA</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const admin = user.role === "admin";
                  const you = viewer?.id === user.id;
                  const owned = ownedBy(user.id);
                  return (
                    <tr
                      key={user.id}
                      className="cursor-pointer border-t border-border hover:bg-muted/40"
                      onClick={() => router.push(`/admin/users/${user.id}`)}
                      onMouseEnter={() => prefetchQuery(`/api/v1/admin/users/${user.id}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                            {user.username.slice(0, 2).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{user.username}</span>
                              {you ? (
                                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                                  You
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                            admin ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                          )}
                        >
                          {admin ? <Shield className="size-3" /> : <UserRound className="size-3" />}
                          {admin ? "Admin" : "User"}
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">{owned}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "text-xs font-medium",
                            user.totpEnabled ? "text-status-running" : "text-muted-foreground",
                          )}
                        >
                          {user.totpEnabled ? "On" : "Off"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatCreated(user.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {users.length === 0 ? (
            <p className="border-t border-border px-4 py-10 text-center text-sm text-muted-foreground">
              No users yet.
            </p>
          ) : null}
        </Card>
      )}
    </AdminPage>
  );
}

function formatCreated(value: string) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "—";
  return new Date(time).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
