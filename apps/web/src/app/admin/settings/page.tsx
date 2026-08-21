"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Mail, Send } from "lucide-react";
import { Button, NumberInput, PasswordInput, Select, Switch, TextInput } from "@mantine/core";
import { AdminError, AdminPage, ListSkeleton } from "@/components/admin-table";
import { AdminSection } from "@/components/admin-create";
import { useAuth } from "@/components/auth-provider";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import type { SmtpEncryption } from "@flutter-software/shared";

type SmtpPublic = {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  passwordSet: boolean;
  encryption: SmtpEncryption;
  fromEmail: string;
  fromName: string;
  configured: boolean;
  source: "database" | "env" | "none";
  envFallback: boolean;
};

export default function AdminSettingsPage() {
  const { user } = useAuth();
  const { data, error: loadError, reload } = useQuery<{ data: { smtp: SmtpPublic } }>(
    "/api/v1/admin/settings",
  );
  const smtp = data?.data.smtp;
  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState(587);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [encryption, setEncryption] = useState<SmtpEncryption>("starttls");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("Flutter");
  const [testTo, setTestTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!smtp) return;
    setEnabled(smtp.enabled);
    setHost(smtp.host);
    setPort(smtp.port || 587);
    setUsername(smtp.username);
    setPassword("");
    setEncryption(smtp.encryption);
    setFromEmail(smtp.fromEmail);
    setFromName(smtp.fromName || "Flutter");
  }, [smtp]);

  useEffect(() => {
    if (user?.email && !testTo) setTestTo(user.email);
  }, [user?.email, testTo]);

  function body() {
    return {
      enabled,
      host: host.trim(),
      port: port || 587,
      username: username.trim(),
      encryption,
      fromEmail: fromEmail.trim(),
      fromName: fromName.trim() || "Flutter",
      ...(password ? { password } : {}),
    };
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      await api("/api/v1/admin/settings", {
        method: "PATCH",
        body: JSON.stringify(body()),
      });
      setPassword("");
      await reload();
      setNotice("SMTP settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  async function onTest() {
    setError(null);
    setNotice(null);
    setTesting(true);
    try {
      const result = await api<{ data: { to: string } }>("/api/v1/admin/settings/smtp/test", {
        method: "POST",
        body: JSON.stringify({ to: testTo.trim(), ...body() }),
      });
      setNotice(`Test email sent to ${result.data.to}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  const sourceLabel =
    smtp?.source === "database"
      ? "Mail is sent using these panel settings."
      : smtp?.source === "env"
        ? "Mail is currently sent using SMTP variables from the server environment. Saving here takes over."
        : smtp?.envFallback
          ? "Panel SMTP is off. The server environment still has SMTP variables as a fallback."
          : "Mail is not configured. Invites will show a copyable setup link instead.";

  return (
    <AdminPage
      title="Settings"
      description="Panel-wide options. SMTP is used for subuser invites and other mail from Flutter."
    >
      <AdminError message={loadError} />
      {!data && !loadError ? (
        <ListSkeleton rows={2} />
      ) : (
        <form onSubmit={(event) => void onSave(event)} className="space-y-6">
          {error ? <AdminError message={error} /> : null}
          {notice ? (
            <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm">{notice}</p>
          ) : null}

          <AdminSection icon={<Mail className="size-4" />} title="Mail" description={sourceLabel}>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-3">
              <div>
                <p className="text-sm font-medium">Send email through SMTP</p>
                <p className="text-xs text-muted-foreground">
                  When this is off, Flutter will not send mail from the panel settings.
                </p>
              </div>
              <Switch
                checked={enabled}
                onChange={(event) => setEnabled(event.currentTarget.checked)}
                aria-label="Send email through SMTP"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput
                label="Host"
                required={enabled}
                value={host}
                onChange={(event) => setHost(event.currentTarget.value)}
                placeholder="smtp.example.com"
                autoComplete="off"
              />
              <NumberInput
                label="Port"
                required={enabled}
                min={1}
                max={65535}
                value={port}
                onChange={(value) => setPort(typeof value === "number" ? value : 587)}
              />
            </div>

            <Select
              label="Encryption"
              description="STARTTLS is typical on port 587. TLS/SSL is typical on 465."
              data={[
                { value: "none", label: "None" },
                { value: "starttls", label: "STARTTLS" },
                { value: "tls", label: "TLS / SSL" },
              ]}
              value={encryption}
              onChange={(value) => {
                if (value === "none" || value === "starttls" || value === "tls") setEncryption(value);
              }}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput
                label="Username"
                value={username}
                onChange={(event) => setUsername(event.currentTarget.value)}
                autoComplete="off"
              />
              <PasswordInput
                label="Password"
                description={smtp?.passwordSet ? "Leave blank to keep the saved password." : undefined}
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                autoComplete="new-password"
                placeholder={smtp?.passwordSet ? "••••••••" : ""}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput
                label="From name"
                value={fromName}
                onChange={(event) => setFromName(event.currentTarget.value)}
              />
              <TextInput
                type="email"
                label="From address"
                required={enabled}
                value={fromEmail}
                onChange={(event) => setFromEmail(event.currentTarget.value)}
                placeholder="noreply@example.com"
              />
            </div>

            <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
              <TextInput
                className="min-w-56 flex-1"
                type="email"
                label="Send a test to"
                value={testTo}
                onChange={(event) => setTestTo(event.currentTarget.value)}
                placeholder="you@example.com"
              />
              <Button
                type="button"
                variant="default"
                disabled={testing || !testTo.trim()}
                leftSection={<Send className="size-3.5" />}
                onClick={() => void onTest()}
              >
                {testing ? "Sending…" : "Send test"}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </AdminSection>
        </form>
      )}
    </AdminPage>
  );
}
