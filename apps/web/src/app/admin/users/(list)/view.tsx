"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Shield } from "lucide-react";
import { AdminPage } from "@/components/admin-table";
import { AdminUsersPageSkeleton } from "@/components/skeletons";
import { QueryErrorPage } from "@/components/error-page";
import { useAuth } from "@/components/auth-provider";
import { ButtonLink, EmptyState, Rack, RowField } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/cn";
import { prefetchQuery, useQuery } from "@/lib/query";
import type { ServerRecord } from "@/lib/types";
import type { PublicUser } from "@flutter-software/shared";

const COLUMNS = "lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,0.6fr)_minmax(0,0.5fr)_minmax(0,0.6fr)_minmax(0,0.8fr)]";

export default function AdminUsersPage({ skeletonCount }: { skeletonCount?: number }) {
  const router = useRouter();
  const { user: viewer } = useAuth();
  const { data, error, errorStatus, reload } = useQuery<{ data: { users: PublicUser[] } }>("/api/v1/admin/users");
  const servers = useQuery<{ data: { servers: ServerRecord[] } }>("/api/v1/admin/servers");
  const users = data?.data.users ?? [];
  const ownedBy = (userId: string) =>
    (servers.data?.data.servers ?? []).filter((server) => server.ownerId === userId).length;

  if (error && !data) {
    return (
      <QueryErrorPage
        error={error}
        status={errorStatus}
        onRetry={() => void reload()}
        homeHref="/admin"
        homeLabel="Back to admin"
      />
    );
  }

  if (!data) {
    return <AdminUsersPageSkeleton count={skeletonCount} />;
  }

  return (
    <AdminPage
      title="Users"
      description="Accounts that can sign in and own servers. Select a user to edit them."
      actions={
        <ButtonLink href="/admin/users/new">
          <Plus className="size-4" />
          New user
        </ButtonLink>
      }
    >
      {users.length === 0 ? (
        <EmptyState
          title="No users yet"
          description="Create an account for each person who should sign in or own servers."
        />
      ) : (
        <div>
          {/* Column legend for wide screens; rows wrap into labelled lines below lg. */}
          <div aria-hidden className={cn("hidden px-4 py-2 text-[12px] text-muted-foreground lg:grid lg:gap-5", COLUMNS)}>
            <span className="pl-1">User</span>
            <span>Email</span>
            <span>Role</span>
            <span>Servers</span>
            <span>Two-factor</span>
            <span>Created</span>
          </div>
          <Rack label="Users">
            {users.map((user) => {
              const admin = user.role === "admin";
              const you = viewer?.id === user.id;
              const owned = ownedBy(user.id);
              return (
                <div
                  key={user.id}
                  role="listitem"
                  className={cn(
                    "relative grid cursor-pointer grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 hover:bg-muted/45 sm:grid-cols-4 lg:items-center lg:gap-5",
                    COLUMNS,
                  )}
                  onClick={() => router.push(`/admin/users/${user.id}`)}
                  onMouseEnter={() => prefetchQuery(`/api/v1/admin/users/${user.id}`)}
                >
                  <div className="col-span-full flex min-w-0 items-center gap-3 pl-1 lg:col-span-1">
                    <UserAvatar user={user} size="sm" />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <Link
                          href={`/admin/users/${user.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="truncate font-display text-[17px] font-semibold leading-tight hover:text-primary"
                        >
                          {user.username}
                        </Link>
                        {you ? <span className="shrink-0 text-[12px] text-muted-foreground">(you)</span> : null}
                      </div>
                      <p className="truncate text-[13px] text-muted-foreground lg:hidden">{user.email}</p>
                    </div>
                  </div>
                  <p className="hidden min-w-0 truncate text-sm text-muted-foreground lg:block">{user.email}</p>
                  <RowField breakpoint="lg" label="Role">
                    <span className={cn("inline-flex items-center gap-1.5", admin ? "text-primary" : "text-foreground")}>
                      {admin ? <Shield className="size-3.5" aria-hidden /> : null}
                      {admin ? "Admin" : "User"}
                    </span>
                  </RowField>
                  <RowField breakpoint="lg" label="Servers">
                    <span className="tabular-nums">{owned}</span>
                  </RowField>
                  <RowField breakpoint="lg" label="Two-factor">
                    <span className={user.totpEnabled ? "text-status-running" : "text-muted-foreground"}>
                      {user.totpEnabled ? "On" : "Off"}
                    </span>
                  </RowField>
                  <RowField breakpoint="lg" label="Created">
                    <span className="tabular-nums text-muted-foreground">{formatCreated(user.createdAt)}</span>
                  </RowField>
                </div>
              );
            })}
          </Rack>
        </div>
      )}
    </AdminPage>
  );
}

function formatCreated(value: string) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "Unknown";
  return new Date(time).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

