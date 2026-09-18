"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Check, Copy, Image as ImageIcon, KeyRound, Mail, RefreshCw, Send } from "lucide-react";
import { Button, NumberInput, PasswordInput, Select, Switch, TextInput } from "@mantine/core";
import { AdminError, AdminPage } from "@/components/admin-table";
import { SettingsWorkspaceSkeleton } from "@/components/skeletons";
import { useAuth } from "@/components/auth-provider";
import { DEFAULT_CONSOLE_TAG, DEFAULT_LOGO_SRC, DEFAULT_SITE_NAME, useBranding } from "@/components/branding-provider";
import { UpdatesSection } from "./updates-section";
import { IdentityStudio } from "./identity-studio";
import {
  parseSettingsSection,
  SettingsActions,
  SettingsWorkspace,
  type SettingsSection,
} from "./workspace";
import { toast } from "@/components/toast";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { normalizeConsoleTag, type SmtpEncryption } from "@flutter-software/shared";

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
  consoleTag: string;
  hasLogo: boolean;
  logoUrl: string | null;
};

type OidcPublic = {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecretSet: boolean;
  buttonLabel: string;
  scopes: string;
  allowedDomains: string;
  passwordLogin: boolean;
  redirectUri: string;
  configured: boolean;
  source: "database" | "env" | "none";
  envFallback: boolean;
};

type UpdateStatus = {
  version: string;
  updateAvailable: boolean;
  checkError: string | null;
  job: { state: string };
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
    data: { smtp: SmtpPublic; oidc: OidcPublic; branding: BrandingPublic };
  }>("/api/v1/admin/settings");
  const updates = useQuery<{ data: UpdateStatus }>("/api/v1/admin/settings/update");
  const smtp = data?.data.smtp;
  const oidc = data?.data.oidc;
  const branding = data?.data.branding;
  const [section, setSection] = useState<SettingsSection>("branding");
  const [siteName, setSiteName] = useState(DEFAULT_SITE_NAME);
  const [consoleTag, setConsoleTag] = useState(DEFAULT_CONSOLE_TAG);
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
  const [pending, setPending] = useState(false);
  const [brandingPending, setBrandingPending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [oidcIssuer, setOidcIssuer] = useState("");
  const [oidcClientId, setOidcClientId] = useState("");
  const [oidcClientSecret, setOidcClientSecret] = useState("");
  const [oidcButtonLabel, setOidcButtonLabel] = useState("Sign in with SSO");
  const [oidcScopes, setOidcScopes] = useState("openid email profile");
  const [oidcDomains, setOidcDomains] = useState("");
  const [oidcPasswordLogin, setOidcPasswordLogin] = useState(true);
  const [oidcPending, setOidcPending] = useState(false);
  const [oidcTesting, setOidcTesting] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);

  useEffect(() => {
    const apply = () => {
      const parsed = parseSettingsSection(window.location.hash.replace(/^#/, ""));
      if (parsed) setSection(parsed);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

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
    setConsoleTag(branding.consoleTag || DEFAULT_CONSOLE_TAG);
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
    if (!oidc) return;
    setOidcEnabled(oidc.enabled);
    setOidcIssuer(oidc.issuer);
    setOidcClientId(oidc.clientId);
    setOidcClientSecret("");
    setOidcButtonLabel(oidc.buttonLabel || "Sign in with SSO");
    setOidcScopes(oidc.scopes || "openid email profile");
    setOidcDomains(oidc.allowedDomains);
    setOidcPasswordLogin(oidc.passwordLogin);
  }, [oidc]);

  useEffect(() => {
    if (user?.email && !testTo) setTestTo(user.email);
  }, [user?.email, testTo]);

  function selectSection(id: SettingsSection) {
    setSection(id);
    setError(null);
    if (window.location.hash.replace(/^#/, "") !== id) {
      history.replaceState(null, "", `#${id}`);
    }
  }

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
    const name = siteName.trim();
    if (!name) {
      setError("Site name is required.");
      return;
    }
    const tag = normalizeConsoleTag(consoleTag);
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
          consoleTag: tag,
          ...(removeLogo ? { logo: null } : mime && logoFile ? { logo: { mime, data: await fileToBase64(logoFile) } } : {}),
        }),
      });
      setLogoFile(null);
      setRemoveLogo(false);
      await reload();
      await reloadBranding();
      toast("Branding saved.", "info");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBrandingPending(false);
    }
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api("/api/v1/admin/settings", {
        method: "PATCH",
        body: JSON.stringify(smtpBody()),
      });
      setPassword("");
      await reload();
      toast("SMTP settings saved.", "info");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  async function onTest() {
    setError(null);
    setTesting(true);
    try {
      const result = await api<{ data: { to: string } }>("/api/v1/admin/settings/smtp/test", {
        method: "POST",
        body: JSON.stringify({ to: testTo.trim(), ...smtpBody() }),
      });
      toast(`Test email sent to ${result.data.to}.`, "info");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  function oidcBody() {
    return {
      enabled: oidcEnabled,
      issuer: oidcIssuer.trim(),
      clientId: oidcClientId.trim(),
      buttonLabel: oidcButtonLabel.trim() || "Sign in with SSO",
      scopes: oidcScopes.trim() || "openid email profile",
      allowedDomains: oidcDomains.trim(),
      passwordLogin: oidcPasswordLogin,
      ...(oidcClientSecret ? { clientSecret: oidcClientSecret } : {}),
    };
  }

  async function onSaveOidc(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setOidcPending(true);
    try {
      await api("/api/v1/admin/settings/oidc", {
        method: "PATCH",
        body: JSON.stringify(oidcBody()),
      });
      setOidcClientSecret("");
      await reload();
      toast("SSO settings saved.", "info");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setOidcPending(false);
    }
  }

  async function onTestOidc() {
    setError(null);
    setOidcTesting(true);
    try {
      const result = await api<{
        data: { issuer: string; authorizationEndpoint: string };
      }>("/api/v1/admin/settings/oidc/test", {
        method: "POST",
        body: JSON.stringify({ issuer: oidcIssuer.trim() }),
      });
      toast(`Discovery succeeded. Authorization endpoint: ${result.data.authorizationEndpoint}`, "info");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discovery failed");
    } finally {
      setOidcTesting(false);
    }
  }

  async function copyRedirect() {
    if (!oidc?.redirectUri) return;
    try {
      await navigator.clipboard.writeText(oidc.redirectUri);
      setCopiedUri(true);
      window.setTimeout(() => setCopiedUri(false), 1600);
    } catch {
      setError("Could not copy the redirect URI.");
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

  const oidcLabel =
    oidc?.source === "database"
      ? "Users can sign in through this OpenID Connect provider."
      : oidc?.source === "env"
        ? "SSO is currently using OIDC variables from the server environment. Saving here takes over."
        : oidc?.envFallback
          ? "Panel SSO is off. The server environment still has OIDC variables as a fallback."
          : "Add an OpenID Connect issuer so users can sign in with your internal IdP.";

  const previewSrc = logoPreview ?? (removeLogo ? DEFAULT_LOGO_SRC : branding?.logoUrl || DEFAULT_LOGO_SRC);
  const canResetLogo = Boolean(logoFile || (branding?.hasLogo && !removeLogo));
  const update = updates.data?.data;
  const updateHint = update?.job.state === "running"
    ? "Installing…"
    : update?.updateAvailable
      ? "Update ready"
      : update?.checkError
        ? "Could not check"
        : update?.version
          ? `v${update.version}`
          : "Checking…";
  const mailHint = enabled
    ? host.trim() || "Waiting for host"
    : smtp?.source === "env" || smtp?.envFallback
      ? "Using .env"
      : "Not sending";
  const ssoHint = oidcEnabled
    ? oidcPasswordLogin
      ? "OIDC + passwords"
      : "OIDC only"
    : oidcPasswordLogin
      ? "Passwords only"
      : "Sign-in locked";

  const pane: Record<SettingsSection, { title: string; description: string; icon: ReactNode }> = {
    branding: {
      title: "Identity",
      description: "Site name, logo, and the tag on server consoles.",
      icon: <ImageIcon className="size-4" />,
    },
    updates: {
      title: "Updates",
      description: update?.updateAvailable
        ? "A newer panel build is available from GitHub."
        : update?.checkError || "This panel is up to date.",
      icon: <RefreshCw className="size-4" />,
    },
    mail: {
      title: "Mail",
      description: sourceLabel,
      icon: <Mail className="size-4" />,
    },
    sso: {
      title: "Sign-in",
      description: oidcLabel,
      icon: <KeyRound className="size-4" />,
    },
  };

  return (
    <AdminPage
      className="max-w-7xl"
      title="Settings"
      description="Identity, updates, mail, and how people sign in."
    >
      <AdminError message={loadError} />
      {!data && !loadError ? (
        <SettingsWorkspaceSkeleton />
      ) : (
        <SettingsWorkspace
          section={section}
          onSection={selectSection}
          title={pane[section].title}
          description={pane[section].description}
          icon={pane[section].icon}
          error={error}
          items={[
            {
              id: "branding",
              kicker: "Identity",
              title: siteName.trim() || "Panel name",
              hint: "Logo, name, and console",
              icon: <ImageIcon className="size-4" />,
              media: (
                <img src={previewSrc} alt="" className="size-9 object-contain p-0.5" />
              ),
              tone: "info",
            },
            {
              id: "updates",
              kicker: "Panel",
              title: "Updates",
              hint: updateHint,
              icon: <RefreshCw className="size-4" />,
              tone: update?.job.state === "running"
                ? "info"
                : update?.updateAvailable || update?.checkError
                  ? "warn"
                  : "ok",
            },
            {
              id: "mail",
              kicker: "Delivery",
              title: "Mail",
              hint: mailHint,
              icon: <Mail className="size-4" />,
              tone: enabled ? "ok" : smtp?.source === "env" || smtp?.envFallback ? "warn" : "off",
            },
            {
              id: "sso",
              kicker: "Access",
              title: "Sign-in",
              hint: ssoHint,
              icon: <KeyRound className="size-4" />,
              tone: oidcEnabled ? "ok" : "off",
            },
          ]}
        >
          {section === "branding" ? (
            <IdentityStudio
              siteName={siteName}
              onSiteName={setSiteName}
              consoleTag={consoleTag}
              onConsoleTag={setConsoleTag}
              previewSrc={previewSrc}
              canReset={canResetLogo}
              pending={brandingPending}
              onFile={(file) => {
                setLogoFile(file);
                setRemoveLogo(false);
              }}
              onReset={() => {
                setLogoFile(null);
                setRemoveLogo(true);
              }}
              onSubmit={(event) => void onSaveBranding(event)}
            />
          ) : null}

          <div className={section === "updates" ? "block" : "hidden"}>
            <UpdatesSection framed={false} />
          </div>

          {section === "mail" ? (
            <form className="space-y-4" onSubmit={(event) => void onSave(event)}>
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3">
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

              <SettingsActions>
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
                  {pending ? "Saving…" : "Save mail"}
                </Button>
              </SettingsActions>
            </form>
          ) : null}

          {section === "sso" ? (
            <form className="space-y-4" onSubmit={(event) => void onSaveOidc(event)}>
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Enable OpenID Connect</p>
                  <p className="text-xs text-muted-foreground">
                    Shows a sign-in button on the login page when the issuer, client ID, and secret are set.
                  </p>
                </div>
                <Switch
                  checked={oidcEnabled}
                  onChange={(event) => setOidcEnabled(event.currentTarget.checked)}
                  aria-label="Enable OpenID Connect"
                />
              </div>

              <div className="rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-sm font-medium">Redirect URI</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Register this exact URL on the identity provider.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs">
                    {oidc?.redirectUri || "—"}
                  </code>
                  <Button
                    type="button"
                    variant="default"
                    disabled={!oidc?.redirectUri}
                    onClick={() => void copyRedirect()}
                    leftSection={copiedUri ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  >
                    {copiedUri ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>

              <TextInput
                label="Issuer URL"
                required={oidcEnabled}
                value={oidcIssuer}
                onChange={(event) => setOidcIssuer(event.currentTarget.value)}
                placeholder="https://auth.example.com/application/o/flutter/"
                autoComplete="off"
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <TextInput
                  label="Client ID"
                  required={oidcEnabled}
                  value={oidcClientId}
                  onChange={(event) => setOidcClientId(event.currentTarget.value)}
                  autoComplete="off"
                />
                <PasswordInput
                  label="Client secret"
                  description={oidc?.clientSecretSet ? "Leave blank to keep the saved secret." : undefined}
                  value={oidcClientSecret}
                  onChange={(event) => setOidcClientSecret(event.currentTarget.value)}
                  autoComplete="new-password"
                  placeholder={oidc?.clientSecretSet ? "••••••••" : ""}
                />
                <TextInput
                  label="Button label"
                  value={oidcButtonLabel}
                  onChange={(event) => setOidcButtonLabel(event.currentTarget.value)}
                  placeholder="Sign in with SSO"
                />
                <TextInput
                  label="Scopes"
                  value={oidcScopes}
                  onChange={(event) => setOidcScopes(event.currentTarget.value)}
                  placeholder="openid email profile"
                />
              </div>

              <TextInput
                label="Allowed email domains"
                description="Optional. Comma-separated, for example company.com. Leave blank to allow any domain."
                value={oidcDomains}
                onChange={(event) => setOidcDomains(event.currentTarget.value)}
                placeholder="company.com"
              />

              <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Allow password sign-in</p>
                  <p className="text-xs text-muted-foreground">
                    Turn this off to require SSO after the first admin account exists.
                  </p>
                </div>
                <Switch
                  checked={oidcPasswordLogin}
                  onChange={(event) => setOidcPasswordLogin(event.currentTarget.checked)}
                  aria-label="Allow password sign-in"
                />
              </div>

              <SettingsActions>
                <Button
                  type="button"
                  variant="default"
                  disabled={oidcTesting || !oidcIssuer.trim()}
                  onClick={() => void onTestOidc()}
                >
                  {oidcTesting ? "Testing…" : "Test discovery"}
                </Button>
                <Button type="submit" disabled={oidcPending} className="ml-auto">
                  {oidcPending ? "Saving…" : "Save sign-in"}
                </Button>
              </SettingsActions>
            </form>
          ) : null}
        </SettingsWorkspace>
      )}
    </AdminPage>
  );
}
