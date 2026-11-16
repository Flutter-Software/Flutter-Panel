"use client";

import { useState, type FormEvent } from "react";
import { Button, Field, Input } from "@/components/ui";
import { AuthError } from "@/components/brand";
import { api, type AuthResponse } from "@/lib/api";
import type { PublicUser } from "@flutter-software/shared";

export function VerifyEmailForm({
  email,
  onVerified,
}: {
  email: string;
  onVerified: (user: PublicUser) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code") ?? "").replace(/\D/g, "").slice(0, 6);
    try {
      const result = await api<AuthResponse>("/api/v1/auth/verify", {
        method: "POST",
        body: JSON.stringify({ email, code }),
      });
      if (!result.data.user) {
        throw new Error("Verification failed");
      }
      onVerified(result.data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    setError(null);
    setResent(false);
    setResending(true);
    try {
      await api("/api/v1/auth/verify/resend", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setResent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend the code");
    } finally {
      setResending(false);
    }
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={(event) => void onSubmit(event)}>
      <Field label="Verification code">
        <Input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          maxLength={8}
          placeholder="481 902"
          className="h-11 font-mono text-lg tracking-[0.3em]"
        />
      </Field>
      {error ? <AuthError>{error}</AuthError> : null}
      {resent ? <p className="text-sm text-muted-foreground">New code sent. If it isn&apos;t in your inbox in a minute, check spam.</p> : null}
      <Button type="submit" className="h-10 w-full" disabled={pending}>
        {pending ? "Checking code…" : "Verify email"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Didn&apos;t get it?{" "}
        <button
          type="button"
          className="font-medium text-primary hover:underline disabled:opacity-60"
          onClick={() => void resend()}
          disabled={resending}
        >
          {resending ? "Sending…" : "Resend code"}
        </button>
      </p>
    </form>
  );
}
