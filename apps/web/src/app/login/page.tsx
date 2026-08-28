"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthBrand } from "@/components/brand";
import { Button, Input } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import { api, type AuthResponse, type SetupResponse } from "@/lib/api";
import { PANEL_VERSION } from "@flutter-software/shared";

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useAuth();
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [totpToken, setTotpToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");

  useEffect(() => {
    api<SetupResponse>("/api/v1/auth/setup")
      .then((result) => setInitialized(result.data.initialized))
      // If setup is unreachable, show the login form — not the first-admin
      // register screen. An empty panel still answers this endpoint.
      .catch(() => setInitialized(true));
  }, []);

  const setupMode = initialized === false;

  function finishLogin(user: AuthResponse["data"]["user"]) {
    if (!user) throw new Error("Sign in failed");
    setUser(user);
    const next = new URLSearchParams(window.location.search).get("next");
    router.push(next?.startsWith("/") ? next : "/");
    router.refresh();
  }

  async function submitTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!totpToken) return;
    setError(null);
    setPending(true);
    try {
      const result = await api<AuthResponse>("/api/v1/auth/totp/login", {
        method: "POST",
        body: JSON.stringify({ token: totpToken, code: totpCode }),
      });
      finishLogin(result.data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-[400px]">
        <AuthBrand className="mb-8" />

        <div className="rounded-xl border border-border bg-card p-8">
          <h1 className="text-2xl font-semibold tracking-tight">
            {setupMode ? "Create admin" : totpToken ? "Authenticator code" : "Sign in"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totpToken
              ? "Enter the 6-digit code from your authenticator app."
              : "Game-server control panel."}
          </p>

          {totpToken ? (
            <form className="mt-6 space-y-4" onSubmit={(event) => void submitTotp(event)}>
              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Authentication code
                </span>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  maxLength={8}
                  placeholder="000000"
                  className="h-12 text-center font-mono text-xl tracking-[0.35em]"
                  value={totpCode}
                  onChange={(event) => setTotpCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
                />
              </label>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="h-11 w-full" disabled={pending || totpCode.length !== 6}>
                {pending ? "Please wait…" : "Verify"}
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm font-medium text-primary"
                onClick={() => {
                  setTotpToken(null);
                  setTotpCode("");
                  setError(null);
                }}
              >
                Back to sign in
              </button>
            </form>
          ) : (
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
                const result = await api<AuthResponse>(path, {
                  method: "POST",
                  body: JSON.stringify(body),
                });
                if (result.data.needsVerification && result.data.email) {
                  const next = new URLSearchParams(window.location.search).get("next");
                  const verify = `/verify?email=${encodeURIComponent(result.data.email)}`;
                  router.push(
                    next?.startsWith("/") ? `${verify}&next=${encodeURIComponent(next)}` : verify,
                  );
                  return;
                }
                if (result.data.needsTotp && result.data.totpToken) {
                  setTotpToken(result.data.totpToken);
                  setTotpCode("");
                  return;
                }
                finishLogin(result.data.user);
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
          )}

          {totpToken ? null : setupMode ? (
            <p className="mt-5 text-center text-sm text-muted-foreground">
              First account becomes the panel administrator.
            </p>
          ) : (
            <p className="mt-5 text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link href="/register" className="font-medium text-primary">
                Create an account
              </Link>
            </p>
          )}
        </div>
      </div>

      <p className="absolute bottom-6 font-mono text-xs text-muted-foreground">v{PANEL_VERSION}</p>
    </div>
  );
}
