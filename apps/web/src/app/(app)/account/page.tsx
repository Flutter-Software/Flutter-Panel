"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { Badge, Button, Input } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";
import { api } from "@/lib/api";
import type { PublicUser } from "@flutter-software/shared";
import { SettingsFooter, SettingsMessage, SettingsPanel, SettingsRow, SettingsSection } from "./settings-nav";

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
      setSuccess("Changes saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile");
    } finally {
      setPending(false);
    }
  }

  const initials = initialsFromEmail(user?.email ?? email);

  return (
    <SettingsSection title="Profile" description="Your name, email and picture as other people on this panel see them.">
      <form onSubmit={(event) => void onSave(event)}>
        <SettingsPanel>
          <SettingsRow title="Picture" description="Shown next to your name in the panel. Click it to change it.">
            <div className="flex items-center gap-4">
              <UserAvatar
                user={user}
                initials={initials}
                size="lg"
                editable
                onChanged={(next) => {
                  setUser(next);
                  setError(null);
                }}
                onError={setError}
              />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-display text-[20px] font-semibold leading-tight">
                    {(user?.username ?? username) || "No name set"}
                  </span>
                  {user?.role === "admin" ? <Badge>Admin</Badge> : null}
                </p>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">{(user?.email ?? email) || "No email set"}</p>
              </div>
            </div>
          </SettingsRow>
          <SettingsRow title="Display name" description="3 to 32 characters. You can also sign in with it.">
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Your name"
              autoComplete="username"
              aria-label="Display name"
              required
              minLength={3}
              maxLength={32}
            />
          </SettingsRow>
          <SettingsRow title="Email" description="Used to sign in and for panel emails.">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              aria-label="Email"
              required
            />
          </SettingsRow>
          <SettingsFooter message={<SettingsMessage error={error} success={success} />}>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </SettingsFooter>
        </SettingsPanel>
      </form>
    </SettingsSection>
  );
}
