"use client";

import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui";

export default function AccountPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Profile for the signed-in panel user.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Profile</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Username</dt>
              <dd>{user?.username ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Email</dt>
              <dd>{user?.email ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Role</dt>
              <dd className="capitalize">{user?.role ?? "—"}</dd>
            </div>
          </dl>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Security</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Two-factor authentication and API keys are next. Passwords are stored
            with argon2id.
          </p>
        </Card>
      </div>
    </div>
  );
}
