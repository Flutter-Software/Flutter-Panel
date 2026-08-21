"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Image as ImageIcon, Mail, Send } from "lucide-react";
import { Button, FileButton, NumberInput, PasswordInput, Select, Switch, TextInput } from "@mantine/core";
import { AdminError, AdminPage, ListSkeleton } from "@/components/admin-table";
import { AdminSection } from "@/components/admin-create";
import { useAuth } from "@/components/auth-provider";
import { DEFAULT_LOGO_SRC, DEFAULT_SITE_NAME, useBranding } from "@/components/branding-provider";
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

type BrandingPublic = {
  siteName: string;
  hasLogo: boolean;
  logoUrl: string | null;
};

const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

function logoMime(file: File): "image/png" | "image/jpeg" | "image/webp" | "image/gif" | null {
  if (LOGO_TYPES.has(file.type)) {
    return file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  }
  const name = file.name.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  return null;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read logo file"));
    reader.readAsDataURL(file);
  });
}

export default function AdminSettingsPage() {
  const { user } = useAuth();
  const { reload: reloadBranding } = useBranding();
  const { data, error: loadError, reload } = useQuery<{
    data: { smtp: SmtpPublic; branding: BrandingPublic };
  }>("/api/v1/admin/settings");
  const smtp = data?.data.smtp;
  const branding = data?.data.branding;
  const [siteName, setSiteName] = useState(DEFAULT_SITE_NAME);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState(587);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [encryption, setEncryption] = useState<SmtpEncryption>("starttls");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState(DEFAULT_SITE_NAME);
  const [testTo, setTestTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [brandingPending, setBrandingPending] = useState(false);
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
    setFromName(smtp.fromName || DEFAULT_SITE_NAME);
  }, [smtp]);

  useEffect(() => {
    if (!branding) return;
    setSiteName(branding.siteName || DEFAULT_SITE_NAME);
    setLogoFile(null);
    setRemoveLogo(false);
  }, [branding]);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null);
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  useEffect(() => {
    if (user?.email && !testTo) setTestTo(user.email);
  }, [user?.email, testTo]);

  function smtpBody() {
    return {
      enabled,
      host: host.trim(),
      port: port || 587,
      username: username.trim(),
      encryption,
      fromEmail: fromEmail.trim(),
      fromName: fromName.trim() || DEFAULT_SITE_NAME,
      ...(password ? { password } : {}),
    };
  }

  async function onSaveBranding(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const name = siteName.trim();
    if (!name) {
      setError("Site name is required.");
      return;
    }
    if (logoFile && logoFile.size > LOGO_MAX_BYTES) {
      setError("Logo must be 2 MB or smaller.");
      return;
    }
    const mime = logoFile ? logoMime(logoFile) : null;
    if (logoFile && !mime) {
      setError("Logo must be a PNG, JPEG, WebP, or GIF.");
      return;
    }
    setBrandingPending(true);
    try {
      await api("/api/v1/admin/settings/branding", {
        method: "PATCH",
        body: JSON.stringify({
          siteName: name,
          ...(removeLogo ? { logo: null } : mime && logoFile ? { logo: { mime, data: await fileToBase64(logoFile) } } : {}),
        }),
      });
      setLogoFile(null);
      setRemoveLogo(false);
      await reload();
      await reloadBranding();
      setNotice("Branding saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBrandingPending(false);
    }
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      await api("/api/v1/admin/settings", {
        method: "PATCH",
        body: JSON.stringify(smtpBody()),
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
        body: JSON.stringify({ to: testTo.trim(), ...smtpBody() }),
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

  const previewSrc = logoPreview ?? (removeLogo ? DEFAULT_LOGO_SRC : branding?.logoUrl || DEFAULT_LOGO_SRC);
  const canResetLogo = Boolean(logoFile || (branding?.hasLogo && !removeLogo));

  return (
    <AdminPage
      title="Settings"
      description="Panel-wide options. Branding appears in the top bar, login screen, and browser tab."
    >
      <AdminError message={loadError} />
      {!data && !loadError ? (
        <ListSkeleton rows={2} />
      ) : (
        <div className="space-y-6">
          {error ? <AdminError message={error} /> : null}
          {notice ? (
            <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm">{notice}</p>
          ) : null}

          <form onSubmit={(event) => void onSaveBranding(event)}>
            <AdminSection
              icon={<ImageIcon className="size-4" />}
              title="Branding"
              description="Shown in the sidebar header, login page, favicon, and invite emails."
            >
              <TextInput
                label="Site name"
                required
                value={siteName}
                onChange={(event) => setSiteName(event.currentTarget.value)}
                maxLength={48}
              />

              <div className="flex flex-wrap items-center gap-4">
                <img
                  src={previewSrc}
                  alt=""
                  className="size-16 rounded-lg border border-border bg-card object-contain p-1"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm font-medium">Logo</p>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPEG, WebP, or GIF. Square images look best. 2 MB max.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <FileButton
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={(file) => {
                        if (!file) return;
                        setLogoFile(file);
                        setRemoveLogo(false);
                      }}
                    >
                      {(props) => (
                        <Button {...props} type="button" variant="default">
                          Upload logo
                        </Button>
                      )}
                    </FileButton>
                    {canResetLogo ? (
                      <Button
                        type="button"
                        variant="subtle"
                        onClick={() => {
                          setLogoFile(null);
                          setRemoveLogo(true);
                        }}
                      >
                        Use default logo
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="flex justify-end border-t border-border pt-4">
                <Button type="submit" disabled={brandingPending}>
                  {brandingPending ? "Saving…" : "Save branding"}
                </Button>
              </div>
            </AdminSection>
          </form>

          <form onSubmit={(event) => void onSave(event)}>
            <AdminSection icon={<Mail className="size-4" />} title="Mail" description={sourceLabel}>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-3">
                <div>
                  <p className="text-sm font-medium">Send email through SMTP</p>
                  <p className="text-xs text-muted-foreground">
                    When this is off, the panel will not send mail from these settings.
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
        </div>
      )}
    </AdminPage>
  );
}
