"use client";

import { useState, type FormEvent } from "react";
import { PasswordInput } from "@mantine/core";
import type { PublicUser } from "@flutter-software/shared";
import { Button, Card, Input } from "@/components/ui";
import { api } from "@/lib/api";

type SetupPayload = {
  data: { secret: string; otpauth: string; qrDataUrl: string };
};

type UserPayload = { data: { user: PublicUser } };

export function TwoFactorCard({
  enabled,
  onUser,
}: {
  enabled: boolean;
  onUser: (user: PublicUser) => void;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  function resetMessages() {
    setError(null);
    setSuccess(null);
  }

  async function startSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    setPending(true);
    try {
      const result = await api<SetupPayload>("/api/v1/auth/totp/setup", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setPassword("");
      setSecret(result.data.secret);
      setQrDataUrl(result.data.qrDataUrl);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start two-factor setup");
    } finally {
      setPending(false);
    }
  }

  async function confirmSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    setPending(true);
    try {
      const result = await api<UserPayload>("/api/v1/auth/totp/enable", {
        method: "POST",
        body: JSON.stringify({ code: code.replace(/\D/g, "") }),
      });
      setSecret(null);
      setQrDataUrl(null);
      setCode("");
      setSuccess("Two-factor authentication is on.");
      onUser(result.data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enable two-factor authentication");
    } finally {
      setPending(false);
    }
  }

  async function cancelSetup() {
    resetMessages();
    setPending(true);
    try {
      await api("/api/v1/auth/totp/cancel", { method: "POST" });
      setSecret(null);
      setQrDataUrl(null);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel setup");
    } finally {
      setPending(false);
    }
  }

  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    setPending(true);
    try {
      const result = await api<UserPayload>("/api/v1/auth/totp/disable", {
        method: "POST",
        body: JSON.stringify({ password, code: code.replace(/\D/g, "") }),
      });
      setPassword("");
      setCode("");
      setSuccess("Two-factor authentication is off.");
      onUser(result.data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disable two-factor authentication");
    } finally {
      setPending(false);
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card className="p-5 md:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Two-factor authentication</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Use an authenticator app to require a code when you sign in.
          </p>
        </div>
        <span
          className={
            enabled
              ? "rounded-md bg-status-running/15 px-2 py-0.5 text-xs font-medium text-status-running"
              : "rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
          }
        >
          {enabled ? "On" : "Off"}
        </span>
      </div>

      {enabled ? (
        <form className="mt-4 max-w-md space-y-4" onSubmit={(event) => void disable(event)}>
          <PasswordInput
            label="Current password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
          <label className="block space-y-1.5">
            <span className="text-sm">Authenticator code</span>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={8}
              placeholder="000000"
              className="font-mono tracking-[0.25em]"
              value={code}
              onChange={(event) => setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
            />
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {success ? <p className="text-sm text-status-running">{success}</p> : null}
          <Button type="submit" variant="danger" disabled={pending}>
            {pending ? "Disabling…" : "Disable 2FA"}
          </Button>
        </form>
      ) : qrDataUrl && secret ? (
        <div className="mt-5 grid items-start gap-6 sm:grid-cols-[auto_1fr]">
          <div className="flex size-[168px] items-center justify-center rounded-xl bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="Two-factor authentication QR code" className="size-full" />
          </div>
          <form className="space-y-4" onSubmit={(event) => void confirmSetup(event)}>
            <p className="text-sm text-muted-foreground">
              Scan this QR code with Google Authenticator, 1Password, or Authy. You can also enter
              the secret manually.
            </p>
            <button
              type="button"
              className="block w-full truncate rounded-lg border border-border bg-muted/40 px-3 py-2 text-left font-mono text-xs tracking-wide text-foreground hover:bg-muted"
              onClick={() => void copySecret()}
            >
              {copied ? "Copied secret" : secret}
            </button>
            <label className="block space-y-1.5">
              <span className="text-sm">Authenticator code</span>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={8}
                placeholder="000000"
                className="max-w-xs font-mono tracking-[0.25em]"
                value={code}
                onChange={(event) => setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
              />
            </label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending || code.length !== 6}>
                {pending ? "Enabling…" : "Enable 2FA"}
              </Button>
              <Button type="button" variant="secondary" disabled={pending} onClick={() => void cancelSetup()}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      ) : (
        <form className="mt-4 max-w-md space-y-4" onSubmit={(event) => void startSetup(event)}>
          <p className="text-sm text-muted-foreground">
            Confirm your password to generate a QR code for your authenticator app.
          </p>
          <PasswordInput
            label="Current password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {success ? <p className="text-sm text-status-running">{success}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Generating…" : "Show QR code"}
          </Button>
        </form>
      )}
    </Card>
  );
}
