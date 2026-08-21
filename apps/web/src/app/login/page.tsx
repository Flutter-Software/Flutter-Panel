"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthBrand } from "@/components/brand";
import { Button, Input } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import { api, type SetupResponse } from "@/lib/api";
import { PANEL_VERSION, type PublicUser } from "@flutter-software/shared";

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useAuth();
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api<SetupResponse>("/api/v1/auth/setup")
      .then((result) => setInitialized(result.data.initialized))
      .catch(() => setInitialized(true));
  }, []);

  const setupMode = initialized === false;

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-[400px]">
        <AuthBrand className="mb-8" />

        <div className="rounded-xl border border-border bg-card p-8">
          <h1 className="text-2xl font-semibold tracking-tight">
            {setupMode ? "Create admin" : "Sign in"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Game-server control panel.</p>

          <form
            className="mt-6 space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              setError(null);
              setPending(true);
              const form = new FormData(event.currentTarget);
              try {
                const path = setupMode ? "/api/v1/auth/register" : "/api/v1/auth/login";
                const body = setupMode
                  ? {
                      username: String(form.get("username")),
                      email: String(form.get("email")),
                      password: String(form.get("password")),
                    }
                  : {
                      login: String(form.get("email")),
                      password: String(form.get("password")),
                      remember: true,
                    };
                const result = await api<{ data: { user: PublicUser } }>(path, {
                  method: "POST",
                  body: JSON.stringify(body),
                });
                setUser(result.data.user);
                router.push("/");
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Sign in failed");
              } finally {
                setPending(false);
              }
            }}
          >
            {setupMode ? (
              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Username
                </span>
                <Input name="username" autoComplete="username" required placeholder="admin" />
              </label>
            ) : null}
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Email
              </span>
              <Input
                name="email"
                type={setupMode ? "email" : "text"}
                autoComplete={setupMode ? "email" : "username"}
                required
                placeholder="alex@flutter.local"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Password
              </span>
              <Input
                name="password"
                type="password"
                autoComplete={setupMode ? "new-password" : "current-password"}
                required
                minLength={setupMode ? 10 : 1}
                placeholder="••••••••"
              />
            </label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="h-11 w-full" disabled={pending || initialized === null}>
              {pending ? "Please wait…" : setupMode ? "Create admin" : "Sign in"}
            </Button>
          </form>

          {setupMode ? (
            <p className="mt-5 text-center text-sm text-muted-foreground">
              First account becomes the panel administrator.
            </p>
          ) : (
            <p className="mt-5 text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <span className="font-medium text-primary">Create an account</span>
            </p>
          )}
        </div>
      </div>

      <p className="absolute bottom-6 font-mono text-xs text-muted-foreground">v{PANEL_VERSION}</p>
    </div>
  );
}
