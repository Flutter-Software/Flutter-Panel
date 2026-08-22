"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthBrand } from "@/components/brand";
import { Button, Input } from "@/components/ui";
import { api, type AuthResponse, type SetupResponse } from "@/lib/api";
import { PANEL_VERSION } from "@flutter-software/shared";

export default function RegisterPage() {
  const router = useRouter();
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api<SetupResponse>("/api/v1/auth/setup")
      .then((result) => {
        if (!result.data.initialized) {
          router.replace("/login");
          return;
        }
        setInitialized(true);
      })
      .catch(() => setInitialized(true));
  }, [router]);

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-[400px]">
        <AuthBrand className="mb-8" />

        <div className="rounded-xl border border-border bg-card p-8">
          <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            We&apos;ll email you a 6-digit code to verify it.
          </p>

          <form
            className="mt-6 space-y-4"
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
                setError(err instanceof Error ? err.message : "Could not create account");
              } finally {
                setPending(false);
              }
            }}
          >
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Username
              </span>
              <Input name="username" autoComplete="username" required minLength={3} maxLength={32} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Email
              </span>
              <Input name="email" type="email" autoComplete="email" required />
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
                placeholder="At least 10 characters"
              />
            </label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="h-11 w-full" disabled={pending || initialized === null}>
              {pending ? "Creating account…" : "Create account"}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary">
              Sign in
            </Link>
          </p>
        </div>
      </div>

      <p className="absolute bottom-6 font-mono text-xs text-muted-foreground">v{PANEL_VERSION}</p>
    </div>
  );
}
