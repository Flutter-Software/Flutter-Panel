"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthError as FormError, AuthHeading, AuthShell } from "@/components/brand";
import { Button, buttonClass, Field, Input } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import { api, type AuthResponse, type SetupResponse } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useAuth();
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [totpToken, setTotpToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [sso, setSso] = useState<{ enabled: boolean; buttonLabel: string; passwordLogin: boolean }>({
    enabled: false,
    buttonLabel: "Sign in with SSO",
    passwordLogin: true,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "sso") {
      setError("Single sign-on didn't finish. Try again, or sign in with your password if this panel allows it.");
    }
    api<SetupResponse>("/api/v1/auth/setup")
      .then((result) => {
        setInitialized(result.data.initialized);
        if (result.data.sso) setSso(result.data.sso);
      })
      // If setup is unreachable, show the login form — not the first-admin
      // register screen. An empty panel still answers this endpoint.
      .catch(() => setInitialized(true));
  }, []);

  const setupMode = initialized === false;
  const showPassword = setupMode || sso.passwordLogin;
  const showSso = !setupMode && !totpToken && sso.enabled;

  function ssoHref() {
    const next = new URLSearchParams(window.location.search).get("next");
    const qs = next?.startsWith("/") ? `?next=${encodeURIComponent(next)}` : "";
    return `/api/v1/auth/oidc/start${qs}`;
  }

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
      setError(err instanceof Error ? err.message : "Sign-in didn't go through. Check your details and try again.");
    } finally {
      setPending(false);
    }
  }

  const title = setupMode
    ? "Create the admin account"
    : totpToken
      ? "Enter your authenticator code"
      : "Sign in to your panel";
  const intro = setupMode
    ? "This panel has no accounts yet. The first one you create becomes its administrator."
    : totpToken
      ? "Your account has two-factor authentication on. Type the 6-digit code from your authenticator app."
      : showPassword
        ? "Use your email or username and the password for this panel."
        : "This panel signs you in through your organisation's identity provider.";

  return (
    <AuthShell>
      <AuthHeading title={title}>{intro}</AuthHeading>

      {totpToken ? (
        <form className="mt-8 space-y-5" onSubmit={(event) => void submitTotp(event)}>
          <Field label="Authentication code">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={8}
              placeholder="000000"
              // A one-time code is machine text, so it gets the data face (DESIGN.md → Type).
              className="h-11 font-mono text-lg tracking-[0.3em]"
              value={totpCode}
              onChange={(event) => setTotpCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
            />
          </Field>
          {error ? <FormError>{error}</FormError> : null}
          <Button type="submit" className="h-10 w-full" disabled={pending || totpCode.length !== 6}>
            {pending ? "Checking code…" : "Verify and sign in"}
          </Button>
          <button
            type="button"
            className="text-sm font-medium text-primary hover:underline"
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
        <div className="mt-8 space-y-5">
          {showSso ? (
            <a href={ssoHref()} className={buttonClass({ variant: showPassword ? "secondary" : "primary", className: "h-10 w-full" })}>
              {sso.buttonLabel}
            </a>
          ) : null}

          {showSso && showPassword ? (
            <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or with a password
              <span className="h-px flex-1 bg-border" />
            </div>
          ) : null}

          {showPassword ? (
            <form
              className="space-y-5"
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
                  setError(err instanceof Error ? err.message : "Sign-in didn't go through. Check your details and try again.");
                } finally {
                  setPending(false);
                }
              }}
            >
              {setupMode ? (
                <Field label="Username">
                  <Input name="username" autoComplete="username" required placeholder="admin" />
                </Field>
              ) : null}
              <Field label={setupMode ? "Email" : "Email or username"}>
                <Input
                  name="email"
                  type={setupMode ? "email" : "text"}
                  autoComplete={setupMode ? "email" : "username"}
                  required
                  placeholder={setupMode ? "alex@example.com" : "alex@example.com or alex"}
                />
              </Field>
              <Field label="Password" hint={setupMode ? "At least 10 characters." : undefined}>
                <Input
                  name="password"
                  type="password"
                  autoComplete={setupMode ? "new-password" : "current-password"}
                  required
                  minLength={setupMode ? 10 : 1}
                />
              </Field>
              {error ? <FormError>{error}</FormError> : null}
              <Button type="submit" className="h-10 w-full" disabled={pending || initialized === null}>
                {pending ? (setupMode ? "Creating account…" : "Signing in…") : setupMode ? "Create admin account" : "Sign in"}
              </Button>
            </form>
          ) : error ? (
            <FormError>{error}</FormError>
          ) : null}
        </div>
      )}

      {!totpToken && !setupMode && sso.passwordLogin ? (
        <p className="mt-8 border-t border-border pt-5 text-sm text-muted-foreground">
          New here?{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </p>
      ) : null}
    </AuthShell>
  );
}
