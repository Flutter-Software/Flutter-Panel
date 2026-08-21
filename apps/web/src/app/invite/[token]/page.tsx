"use client";

import { use, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthBrand } from "@/components/brand";
import { Button, Input } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import { api } from "@/lib/api";
import { PANEL_VERSION, type PublicUser } from "@flutter-software/shared";

type InviteInfo = {
  email: string;
  serverName: string;
  expired: boolean;
  accountExists: boolean;
};

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const { setUser } = useAuth();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api<{ data: InviteInfo }>(`/api/v1/auth/invite/${encodeURIComponent(token)}`)
      .then((result) => setInfo(result.data))
      .catch((err) => setError(err instanceof Error ? err.message : "Invite not found"));
  }, [token]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!info || info.expired || info.accountExists) return;
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ data: { user: PublicUser; serverId: string | null; href?: string } }>(
        "/api/v1/auth/invite/complete",
        {
          method: "POST",
          body: JSON.stringify({
            token,
            username: String(form.get("username")),
            password: String(form.get("password")),
          }),
        },
      );
      setUser(result.data.user);
      router.push(result.data.href || (result.data.serverId ? `/server/${result.data.serverId}/console` : "/"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-[400px]">
        <AuthBrand className="mb-8" />
        <div className="rounded-xl border border-border bg-card p-8">
          <h1 className="text-2xl font-semibold tracking-tight">Set up your account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {info
              ? `You've been invited to ${info.serverName}.`
              : error
                ? error
                : "Loading invite…"}
          </p>

          {info?.accountExists ? (
            <div className="mt-6 space-y-3">
              <p className="text-sm">
                An account already exists for <span className="font-medium">{info.email}</span>. Sign
                in and this server will be waiting on your dashboard.
              </p>
              <Button type="button" className="h-11 w-full" onClick={() => router.push("/login")}>
                Sign in
              </Button>
            </div>
          ) : info?.expired ? (
            <p className="mt-6 text-sm text-destructive">
              This invite has expired. Ask the server owner to send a new one.
            </p>
          ) : info ? (
            <form className="mt-6 space-y-4" onSubmit={(event) => void onSubmit(event)}>
              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Email
                </span>
                <Input value={info.email} readOnly />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Username
                </span>
                <Input name="username" autoComplete="username" required minLength={3} maxLength={32} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Password
                </span>
                <Input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                />
              </label>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="h-11 w-full" disabled={pending}>
                {pending ? "Creating account…" : "Create account"}
              </Button>
            </form>
          ) : error ? (
            <Button type="button" className="mt-6 h-11 w-full" onClick={() => router.push("/login")}>
              Back to sign in
            </Button>
          ) : null}
        </div>
      </div>
      <p className="absolute bottom-6 font-mono text-xs text-muted-foreground">v{PANEL_VERSION}</p>
    </div>
  );
}
