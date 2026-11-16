"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthError, AuthHeading, AuthShell } from "@/components/brand";
import { Button, Field, Input } from "@/components/ui";
import { api, type AuthResponse, type SetupResponse } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api<SetupResponse>("/api/v1/auth/setup")
      .then((result) => {
        if (!result.data.initialized || result.data.sso?.passwordLogin === false) {
          router.replace("/login");
          return;
        }
        setInitialized(true);
      })
      .catch(() => setInitialized(true));
  }, [router]);

  return (
    <AuthShell>
      <AuthHeading title="Create an account">
        After you submit, we email you a 6-digit code to confirm the address is yours.
      </AuthHeading>

      <form
        className="mt-8 space-y-5"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          setPending(true);
          const form = new FormData(event.currentTarget);
          try {
            const result = await api<AuthResponse>("/api/v1/auth/register", {
              method: "POST",
              body: JSON.stringify({
                username: String(form.get("username")),
                email: String(form.get("email")),
                password: String(form.get("password")),
              }),
            });
            if (result.data.needsVerification && result.data.email) {
              router.push(`/verify?email=${encodeURIComponent(result.data.email)}`);
              return;
            }
            router.push("/");
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "The account wasn't created. Check the details and try again.");
          } finally {
            setPending(false);
          }
        }}
      >
        <Field label="Username">
          <Input name="username" autoComplete="username" required minLength={3} maxLength={32} />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required />
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
        <Button type="submit" className="h-10 w-full" disabled={pending || initialized === null}>
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="mt-8 border-t border-border pt-5 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
