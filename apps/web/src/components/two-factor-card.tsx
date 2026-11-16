"use client";

import { useState, type FormEvent } from "react";
import { PasswordInput } from "@mantine/core";
import type { PublicUser } from "@flutter-software/shared";
import { Button, Field, Input } from "@/components/ui";
import { Led } from "@/components/status";
import {
  SettingsFooter,
  SettingsMessage,
  SettingsPanel,
  SettingsRow,
} from "@/app/(app)/account/settings-nav";
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
      setError(err instanceof Error ? err.message : "Two-factor setup didn't start. Check your password and try again.");
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
      setError(err instanceof Error ? err.message : "That code didn't work. Codes change every 30 seconds, so enter the current one.");
    } finally {
      setPending(false);
    }
  }

  async function cancelSetup() {
    resetMessages();
    setPending(true);
    try {
      // Wipes the pending secret so a later "Show QR" mints a fresh one.
      await api("/api/v1/auth/totp/cancel", { method: "POST" });
      setSecret(null);
      setQrDataUrl(null);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup couldn't be cancelled. Reload the page and try again.");
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
      setError(err instanceof Error ? err.message : "Two-factor is still on. Check your password and the code, then try again.");
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

  const codeInput = (
    <Input
      inputMode="numeric"
      autoComplete="one-time-code"
      required
      maxLength={8}
      placeholder="000000"
      // A one-time code is machine text, so it gets the data face (DESIGN.md → Type).
      className="max-w-[12rem] font-mono tracking-[0.25em]"
      value={code}
      onChange={(event) => setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
    />
  );

  return (
    <SettingsPanel>
      <SettingsRow
        title="Two-factor authentication"
        description="Ask for a code from an authenticator app every time you sign in."
      >
        <p className="flex items-center gap-2 text-sm font-medium md:pt-0.5">
          <Led status={enabled ? "running" : "offline"} />
          <span className={enabled ? "text-status-running" : "text-muted-foreground"}>
            {enabled ? "On" : "Off"}
          </span>
        </p>
      </SettingsRow>

      {enabled ? (
        <form className="divide-y divide-border" onSubmit={(event) => void disable(event)}>
          <SettingsRow title="Turn it off" description="Confirm with your password and a current code.">
            <div className="space-y-4">
              <PasswordInput
                label="Current password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
              <Field label="Authenticator code">{codeInput}</Field>
            </div>
          </SettingsRow>
          <SettingsFooter message={<SettingsMessage error={error} success={success} />}>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? "Turning off…" : "Turn off two-factor"}
            </Button>
          </SettingsFooter>
        </form>
      ) : qrDataUrl && secret ? (
        <form className="divide-y divide-border" onSubmit={(event) => void confirmSetup(event)}>
          <SettingsRow
            title="Scan the code"
            description="Use Google Authenticator, 1Password, Authy or any TOTP app. Or type the key by hand."
          >
            <div className="flex flex-wrap items-start gap-5">
              {/* QR codes need a white quiet zone to scan, whatever the theme. */}
              <div className="flex size-[152px] shrink-0 items-center justify-center rounded-md bg-white p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt="QR code for your authenticator app" className="size-full" />
              </div>
              <div className="min-w-0 flex-1 space-y-4">
                <div className="space-y-1.5">
                  <p className="text-sm">Setup key</p>
                  <button
                    type="button"
                    className="no-press block w-full truncate rounded-md border border-input bg-well px-3 py-2 text-left font-mono text-[13px] text-foreground outline-none hover:border-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring"
                    title="Copy setup key"
                    onClick={() => void copySecret()}
                  >
                    {copied ? "Copied to clipboard" : secret}
                  </button>
                </div>
                <Field label="Code from the app">{codeInput}</Field>
              </div>
            </div>
          </SettingsRow>
          <SettingsFooter message={<SettingsMessage error={error} />}>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => void cancelSetup()}>
              Cancel setup
            </Button>
            <Button type="submit" disabled={pending || code.length !== 6}>
              {pending ? "Turning on…" : "Turn on two-factor"}
            </Button>
          </SettingsFooter>
        </form>
      ) : (
        <form className="divide-y divide-border" onSubmit={(event) => void startSetup(event)}>
          <SettingsRow title="Set it up" description="Confirm your password to get a QR code for your authenticator app.">
            <PasswordInput
              label="Current password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
          </SettingsRow>
          <SettingsFooter message={<SettingsMessage error={error} success={success} />}>
            <Button type="submit" disabled={pending}>
              {pending ? "Getting QR code…" : "Get QR code"}
            </Button>
          </SettingsFooter>
        </form>
      )}
    </SettingsPanel>
  );
}
