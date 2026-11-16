"use client";

import { use, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthError, AuthHeading, AuthShell } from "@/components/brand";
import { QueryErrorPage } from "@/components/error-page";
import { Button, Field, Input } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import { api, HttpError } from "@/lib/api";
import { type PublicUser } from "@flutter-software/shared";

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
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api<{ data: InviteInfo }>(`/api/v1/auth/invite/${encodeURIComponent(token)}`)
      .then((result) => {
        setInfo(result.data);
        setError(null);
        setErrorStatus(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Invite not found");
        setErrorStatus(err instanceof HttpError ? err.status : 404);
      });
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
      setError(err instanceof Error ? err.message : "The account wasn't created. Check the details and try again.");
    } finally {
      setPending(false);
    }
  }

  if (error && !info) {
    return (
      <QueryErrorPage
        error={error}
        status={errorStatus}
        homeHref="/login"
        homeLabel="Back to sign in"
      />
    );
  }

  return (
    <AuthShell>
      <AuthHeading title="Set up your account">
        {info
          ? `You've been invited to ${info.serverName}. Choose a username and password to get in.`
          : error
            ? error
            : "Loading your invite…"}
      </AuthHeading>

      {info?.accountExists ? (
        <div className="mt-8 space-y-5">
          <p className="text-sm">
            An account already exists for <span className="font-medium">{info.email}</span>. Sign
            in with it and the server appears in your list.
          </p>
          <Button type="button" className="h-10 w-full" onClick={() => router.push("/login")}>
            Sign in
          </Button>
        </div>
      ) : info?.expired ? (
        <div className="mt-8">
          <AuthError>This invite has expired. Ask the server owner to send you a new one.</AuthError>
        </div>
      ) : info ? (
        <form className="mt-8 space-y-5" onSubmit={(event) => void onSubmit(event)}>
          <Field label="Email">
            <Input value={info.email} readOnly />
          </Field>
          <Field label="Username">
            <Input name="username" autoComplete="username" required minLength={3} maxLength={32} />
          </Field>
          <Field label="Password" hint="At least 10 characters.">
            <Input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
            />
          </Field>
          {error ? <AuthError>{error}</AuthError> : null}
          <Button type="submit" className="h-10 w-full" disabled={pending}>
            {pending ? "Creating account…" : "Create account"}
          </Button>
        </form>
      ) : null}
    </AuthShell>
  );
}
