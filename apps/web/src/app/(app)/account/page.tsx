"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button, Card, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";
import type { PublicUser } from "@flutter-software/shared";
import { SettingsSection } from "./settings-nav";

function initialsFromEmail(email: string) {
  const local = (email.split("@")[0] ?? "").replace(/[^a-zA-Z]/g, "");
  return (local.slice(0, 2) || "??").toUpperCase();
}

export default function AccountProfilePage() {
  const { user, setUser } = useAuth();
  const [username, setUsername] = useState(user?.username ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!user) return;
    setUsername(user.username);
    setEmail(user.email);
  }, [user]);

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setPending(true);
    try {
      const result = await api<{ data: { user: PublicUser } }>("/api/v1/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({ username, email }),
      });
      setUser(result.data.user);
      setSuccess("Profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile");
    } finally {
      setPending(false);
    }
  }

  const initials = initialsFromEmail(user?.email ?? email);

  return (
    <SettingsSection title="Profile" description="Manage the identity attached to your Flutter account.">
      <Card className="p-5 sm:p-6">
        <h3 className="text-sm font-semibold">Identity</h3>
        <div className="mt-5 flex items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
            {initials}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-medium text-primary">{user?.email ?? "—"}</p>
              {user?.role === "admin" ? (
                <span className="rounded-md bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                  admin
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Avatars are generated from your email initials.
            </p>
          </div>
        </div>
        <form className="mt-6 space-y-5" onSubmit={(event) => void onSave(event)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Display name">
              <Input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Your name"
                autoComplete="username"
                required
                minLength={3}
                maxLength={32}
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </Field>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {success ? <p className="text-sm text-status-running">{success}</p> : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </Card>
    </SettingsSection>
  );
}
