"use client";

/**
 * Admin → Settings.
 *
 * Owns the form state for every section and the "is it dirty?" logic.
 * Layout primitives (grouped nav, cards, unsaved-changes bar) live in
 * ./workspace; Branding, Updates and Telemetry render from their own files.
 *
 * UX rules applied across sections:
 * - Edits are tracked against the last loaded values. Once anything differs,
 *   a floating bar offers Discard / Save (Ctrl/⌘+S). No permanent Save button.
 * - Switching sections or leaving the page with unsaved edits asks first.
 * - Single toggles that stand alone (telemetry) save immediately.
 * - Secrets (SMTP password, OIDC client secret) are never echoed back; an
 *   empty field means "keep the saved value".
 */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Globe,
  Image as ImageIcon,
  KeyRound,
  Mail,
  Radio,
  RefreshCw,
  Send,
  TriangleAlert,
} from "lucide-react";
import { Button, NumberInput, PasswordInput, Switch, TextInput } from "@mantine/core";
import { AdminError, AdminPage } from "@/components/admin-table";
import { SettingsWorkspaceSkeleton } from "@/components/skeletons";
import { useAuth } from "@/components/auth-provider";
import { DEFAULT_CONSOLE_TAG, DEFAULT_LOGO_SRC, DEFAULT_SITE_NAME, useBranding } from "@/components/branding-provider";
import { confirm } from "@/components/confirm-dialog";
import { UpdatesSection, type UpdateStatus } from "./updates-section";
import { IdentityStudio } from "./identity-studio";
import { TelemetrySection, type TelemetryPublic } from "./telemetry-section";
import {
  CopyField,
  parseSettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsSegmented,
  SettingsToggleRow,
  SettingsWorkspace,
  UnsavedChangesBar,
  type SettingsSection,
  type SettingsTab,
  type SettingsTone,
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

/** Form ids: the unsaved-changes bar submits these by id. */
const FORM_ID: Partial<Record<SettingsSection, string>> = {
  branding: "settings-branding-form",
  mail: "settings-mail-form",
  sso: "settings-sso-form",
};

const DEFAULT_SSO_LABEL = "Sign in with SSO";
const DEFAULT_SSO_SCOPES = "openid email profile";

const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Conventional port per encryption mode, used to auto-adjust the port field. */
const SMTP_PORT: Record<SmtpEncryption, number> = { none: 25, starttls: 587, tls: 465 };

const ENCRYPTION_OPTIONS: { value: SmtpEncryption; label: string }[] = [
  { value: "starttls", label: "STARTTLS" },
  { value: "tls", label: "TLS / SSL" },
  { value: "none", label: "None" },
];

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

/** Returns an error message for an unusable logo file, or null when it's fine. */
function logoProblem(file: File) {
  if (!logoMime(file)) return "Logo must be a PNG, JPEG, WebP, or GIF.";
  if (file.size > LOGO_MAX_BYTES) return "Logo must be 2 MB or smaller.";
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
    data: { smtp: SmtpPublic; oidc: OidcPublic; branding: BrandingPublic; telemetry: TelemetryPublic };
  }>("/api/v1/admin/settings");
  // Reported by <UpdatesSection>, which owns the update polling; drives the tab badge.
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const smtp = data?.data.smtp;
  const oidc = data?.data.oidc;
  const branding = data?.data.branding;
  const telemetry = data?.data.telemetry;
  const [section, setSection] = useState<SettingsSection>("branding");
  const [error, setError] = useState<string | null>(null);

  // Branding
  const [siteName, setSiteName] = useState(DEFAULT_SITE_NAME);
  const [consoleTag, setConsoleTag] = useState(DEFAULT_CONSOLE_TAG);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [brandingPending, setBrandingPending] = useState(false);

  // Mail
  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState(587);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [encryption, setEncryption] = useState<SmtpEncryption>("starttls");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState(DEFAULT_SITE_NAME);
  const [testTo, setTestTo] = useState("");
  const [pending, setPending] = useState(false);
  const [testing, setTesting] = useState(false);

  // Sign-in (OIDC)
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [oidcIssuer, setOidcIssuer] = useState("");
  const [oidcClientId, setOidcClientId] = useState("");
  const [oidcClientSecret, setOidcClientSecret] = useState("");
  const [oidcButtonLabel, setOidcButtonLabel] = useState(DEFAULT_SSO_LABEL);
  const [oidcScopes, setOidcScopes] = useState(DEFAULT_SSO_SCOPES);
  const [oidcDomains, setOidcDomains] = useState("");
  const [oidcPasswordLogin, setOidcPasswordLogin] = useState(true);
  const [oidcPending, setOidcPending] = useState(false);
  const [oidcTesting, setOidcTesting] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);

  const [telemetryPending, setTelemetryPending] = useState(false);

  /* ---- Load / reset: copy the saved values into the form ---------------- */

  const resetBranding = useCallback(() => {
    if (!branding) return;
    setSiteName(branding.siteName || DEFAULT_SITE_NAME);
    setConsoleTag(branding.consoleTag || DEFAULT_CONSOLE_TAG);
    setLogoFile(null);
    setRemoveLogo(false);
  }, [branding]);

  const resetMail = useCallback(() => {
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

  const resetOidc = useCallback(() => {
    if (!oidc) return;
    setOidcEnabled(oidc.enabled);
    setOidcIssuer(oidc.issuer);
    setOidcClientId(oidc.clientId);
    setOidcClientSecret("");
    setOidcButtonLabel(oidc.buttonLabel || DEFAULT_SSO_LABEL);
    setOidcScopes(oidc.scopes || DEFAULT_SSO_SCOPES);
    setOidcDomains(oidc.allowedDomains);
    setOidcPasswordLogin(oidc.passwordLogin);
  }, [oidc]);

  useEffect(resetBranding, [resetBranding]);
  useEffect(resetMail, [resetMail]);
  useEffect(resetOidc, [resetOidc]);

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

  /* ---- Dirty tracking ----------------------------------------------------- */

  const brandingDirty = Boolean(
    branding &&
      (siteName !== (branding.siteName || DEFAULT_SITE_NAME) ||
        consoleTag !== (branding.consoleTag || DEFAULT_CONSOLE_TAG) ||
        logoFile ||
        removeLogo),
  );
  const mailDirty = Boolean(
    smtp &&
      (enabled !== smtp.enabled ||
        host !== smtp.host ||
        port !== (smtp.port || 587) ||
        username !== smtp.username ||
        password !== "" ||
        encryption !== smtp.encryption ||
        fromEmail !== smtp.fromEmail ||
        fromName !== (smtp.fromName || DEFAULT_SITE_NAME)),
  );
  const ssoDirty = Boolean(
    oidc &&
      (oidcEnabled !== oidc.enabled ||
        oidcIssuer !== oidc.issuer ||
        oidcClientId !== oidc.clientId ||
        oidcClientSecret !== "" ||
        oidcButtonLabel !== (oidc.buttonLabel || DEFAULT_SSO_LABEL) ||
        oidcScopes !== (oidc.scopes || DEFAULT_SSO_SCOPES) ||
        oidcDomains !== oidc.allowedDomains ||
        oidcPasswordLogin !== oidc.passwordLogin),
  );
  const dirtyBySection: Partial<Record<SettingsSection, boolean>> = {
    branding: brandingDirty,
    mail: mailDirty,
    sso: ssoDirty,
  };
  const dirtySections = new Set(
    (Object.keys(dirtyBySection) as SettingsSection[]).filter((key) => dirtyBySection[key]),
  );
  const anyDirty = dirtySections.size > 0;

  // Browser-level guard for reloads, tab closes and external navigation.
  useEffect(() => {
    if (!anyDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [anyDirty]);

  function discard(target: SettingsSection) {
    if (target === "branding") resetBranding();
    if (target === "mail") resetMail();
    if (target === "sso") resetOidc();
    setError(null);
  }

  /* ---- Navigation ----------------------------------------------------------- */

  const applySection = useCallback((id: SettingsSection) => {
    setSection(id);
    setError(null);
    if (window.location.hash.replace(/^#/, "") !== id) {
      history.replaceState(null, "", `#${id}`);
    }
  }, []);

  useEffect(() => {
    const apply = () => {
      const parsed = parseSettingsSection(window.location.hash.replace(/^#/, ""));
      if (parsed) setSection(parsed);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  async function selectSection(id: SettingsSection) {
    if (id === section) return;
    if (dirtyBySection[section]) {
      const ok = await confirm({
        title: "Discard unsaved changes?",
        description: "You have edits in this section that haven't been saved.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        danger: true,
      });
      if (!ok) return;
      discard(section);
    }
    applySection(id);
  }

  /* ---- Branding ------------------------------------------------------------- */

  function pickLogo(file: File) {
    const problem = logoProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setLogoFile(file);
    setRemoveLogo(false);
  }

  async function onSaveBranding(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const name = siteName.trim();
    if (!name) {
      setError("Panel name is required.");
      return;
    }
    const tag = normalizeConsoleTag(consoleTag);
    const problem = logoFile ? logoProblem(logoFile) : null;
    if (problem) {
      setError(problem);
      return;
    }
    const mime = logoFile ? logoMime(logoFile) : null;
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
      toast("Branding saved.", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBrandingPending(false);
    }
  }

  /* ---- Mail ------------------------------------------------------------------ */

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

  /** Switching encryption moves the port along when it's still a conventional default. */
  function changeEncryption(next: SmtpEncryption) {
    if (Object.values(SMTP_PORT).includes(port)) setPort(SMTP_PORT[next]);
    setEncryption(next);
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (enabled && (!host.trim() || !fromEmail.trim())) {
      setError("Host and from address are required while email delivery is on.");
      return;
    }
    setPending(true);
    try {
      await api("/api/v1/admin/settings", {
        method: "PATCH",
        body: JSON.stringify(smtpBody()),
      });
      setPassword("");
      await reload();
      toast("Mail settings saved.", "success");
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
      toast(`Test email sent to ${result.data.to}.`, "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  /* ---- Sign-in ------------------------------------------------------------- */

  function oidcBody() {
    return {
      enabled: oidcEnabled,
      issuer: oidcIssuer.trim(),
      clientId: oidcClientId.trim(),
      buttonLabel: oidcButtonLabel.trim() || DEFAULT_SSO_LABEL,
      scopes: oidcScopes.trim() || DEFAULT_SSO_SCOPES,
      allowedDomains: oidcDomains.trim(),
      passwordLogin: oidcPasswordLogin,
      ...(oidcClientSecret ? { clientSecret: oidcClientSecret } : {}),
    };
  }

  async function onSaveOidc(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (oidcEnabled && (!oidcIssuer.trim() || !oidcClientId.trim())) {
      setError("Issuer URL and client ID are required while SSO is on.");
      return;
    }
    setOidcPending(true);
    try {
      await api("/api/v1/admin/settings/oidc", {
        method: "PATCH",
        body: JSON.stringify(oidcBody()),
      });
      setOidcClientSecret("");
      await reload();
      toast("Sign-in settings saved.", "success");
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
      toast(`Discovery succeeded. Authorization endpoint: ${result.data.authorizationEndpoint}`, "success");
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

  /* ---- Telemetry (saves immediately) ----------------------------------------- */

  async function onSaveTelemetry(next: boolean) {
    setError(null);
    setTelemetryPending(true);
    try {
      await api("/api/v1/admin/settings/telemetry", {
        method: "PATCH",
        body: JSON.stringify({ enabled: next }),
      });
      await reload();
      toast(next ? "Anonymous telemetry turned on." : "Anonymous telemetry turned off.", "success");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      return false;
    } finally {
      setTelemetryPending(false);
    }
  }

  /* ---- Derived status (from *saved* values, not the draft) ------------------- */

  const updateState: { tone: SettingsTone; status: string } =
    update?.job.state === "running"
      ? { tone: "info", status: "Updating" }
      : update?.updateAvailable
        ? { tone: "warn", status: "Update available" }
        : update?.checkError
          ? { tone: "warn", status: "Check failed" }
          : update
            ? { tone: "ok", status: `v${update.version}` }
            : { tone: "off", status: "Checking…" };

  const mailState: { tone: SettingsTone; status: string } =
    smtp?.source === "database"
      ? { tone: "ok", status: "Active" }
      : smtp?.source === "env"
        ? { tone: "warn", status: "Using environment" }
        : smtp?.envFallback
          ? { tone: "warn", status: "Off, environment fallback" }
          : { tone: "off", status: "Not configured" };

  const ssoState: { tone: SettingsTone; status: string } =
    oidc?.source === "database"
      ? { tone: "ok", status: oidc.passwordLogin ? "SSO and passwords" : "SSO only" }
      : oidc?.source === "env"
        ? { tone: "warn", status: "Using environment" }
        : { tone: "off", status: "Passwords only" };

  const telemetryState: { tone: SettingsTone; status: string } = telemetry?.envDisabled
    ? { tone: "off", status: "Disabled by host" }
    : telemetry?.sending
      ? { tone: "ok", status: "Sharing" }
      : telemetry?.enabled
        ? { tone: "warn", status: "On, not sending" }
        : { tone: "off", status: "Off" };

  const tabs: SettingsTab[] = [
    { id: "branding", label: "General", icon: <ImageIcon /> },
    { id: "sso", label: "Authentication", icon: <KeyRound />, ...ssoState },
    { id: "mail", label: "Email", icon: <Mail />, ...mailState },
    { id: "updates", label: "Updates", icon: <RefreshCw />, ...updateState },
    { id: "telemetry", label: "Telemetry", icon: <Radio />, ...telemetryState },
  ];

  const pane: Record<SettingsSection, { title: string; description: string }> = {
    branding: { title: "General", description: "Your panel's name, logo and console prefix." },
    sso: { title: "Authentication", description: "How people sign in: passwords, single sign-on, or both." },
    mail: { title: "Email", description: "The mail server used for invites, verification links and password resets." },
    updates: { title: "Updates", description: "Keep this panel on the latest release." },
    telemetry: { title: "Telemetry", description: "Anonymous crash and usage reports that help improve Flutter." },
  };

  const previewSrc = logoPreview ?? (removeLogo ? DEFAULT_LOGO_SRC : branding?.logoUrl || DEFAULT_LOGO_SRC);
  const canResetLogo = Boolean(logoFile || (branding?.hasLogo && !removeLogo));
  const signInLocked = !oidcEnabled && !oidcPasswordLogin;
  const formId = FORM_ID[section];
  const saving = section === "branding" ? brandingPending : section === "mail" ? pending : oidcPending;

  return (
    <AdminPage className="max-w-5xl" title="Settings" description="Configure how your panel looks, signs people in, sends email and updates.">
      <AdminError message={loadError} />
      {!data && !loadError ? (
        <SettingsWorkspaceSkeleton />
      ) : (
        <SettingsWorkspace
          section={section}
          onSection={(id) => void selectSection(id)}
          tabs={tabs}
          title={pane[section].title}
          description={pane[section].description}
          error={error}
          dirtySections={dirtySections}
        >
          {section === "branding" ? (
            <IdentityStudio
              formId={FORM_ID.branding!}
              siteName={siteName}
              onSiteName={setSiteName}
              consoleTag={consoleTag}
              onConsoleTag={setConsoleTag}
              previewSrc={previewSrc}
              canReset={canResetLogo}
              pendingFileName={logoFile?.name ?? null}
              onFile={pickLogo}
              onReset={() => {
                setLogoFile(null);
                setRemoveLogo(true);
              }}
              onSubmit={(event) => void onSaveBranding(event)}
            />
          ) : null}

          {/* Kept mounted so a running update keeps streaming (and the tab badge stays live) on other tabs. */}
          <div className={section === "updates" ? "block" : "hidden"}>
            <UpdatesSection onStatus={setUpdate} />
          </div>

          {section === "mail" ? (
            <form id={FORM_ID.mail} className="space-y-5" onSubmit={(event) => void onSave(event)} noValidate>
              <SettingsCard
                title="Mail server"
                description="Your provider's outgoing SMTP server."
                footer={
                  smtp?.source === "env" ? (
                    <EnvNote>SMTP variables in the server environment are in use. Saving here takes over.</EnvNote>
                  ) : smtp?.envFallback && !enabled ? (
                    <EnvNote>The server environment still has SMTP variables as a fallback.</EnvNote>
                  ) : !enabled ? (
                    <span>While off, invites show a copyable setup link instead of sending email.</span>
                  ) : undefined
                }
              >
                <SettingsToggleRow
                  title="Send email"
                  description="Deliver invites, verification links and password resets from this panel."
                  control={
                    <Switch
                      checked={enabled}
                      onChange={(event) => setEnabled(event.currentTarget.checked)}
                      aria-label="Send email"
                    />
                  }
                />
                <SettingsRow label="Host and port" htmlFor="smtp-host" required={enabled}>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]">
                    <TextInput
                      id="smtp-host"
                      value={host}
                      onChange={(event) => setHost(event.currentTarget.value)}
                      placeholder="smtp.example.com"
                      autoComplete="off"
                      leftSection={<Globe className="size-3.5" />}
                    />
                    <NumberInput
                      aria-label="Port"
                      min={1}
                      max={65535}
                      hideControls
                      value={port}
                      onChange={(value) => setPort(typeof value === "number" ? value : 587)}
                    />
                  </div>
                </SettingsRow>
                <SettingsRow label="Encryption" description="The port follows your choice: 587 for STARTTLS, 465 for TLS.">
                  <SettingsSegmented
                    label="Encryption"
                    value={encryption}
                    options={ENCRYPTION_OPTIONS}
                    onChange={changeEncryption}
                  />
                </SettingsRow>
                <SettingsRow label="Username" htmlFor="smtp-username" description="Leave blank if the server doesn't require sign-in.">
                  <TextInput
                    id="smtp-username"
                    value={username}
                    onChange={(event) => setUsername(event.currentTarget.value)}
                    autoComplete="off"
                  />
                </SettingsRow>
                <SettingsRow
                  label="Password"
                  htmlFor="smtp-password"
                  description={smtp?.passwordSet ? "Leave blank to keep the saved password." : undefined}
                >
                  <PasswordInput
                    id="smtp-password"
                    value={password}
                    onChange={(event) => setPassword(event.currentTarget.value)}
                    autoComplete="new-password"
                    placeholder={smtp?.passwordSet ? "••••••••" : ""}
                  />
                </SettingsRow>
              </SettingsCard>

              <SettingsCard
                title="Sender"
                description="Who emails appear to come from."
                footer={
                  <span className="min-w-0 truncate">
                    Recipients see{" "}
                    <span className="font-medium text-foreground">{fromName.trim() || DEFAULT_SITE_NAME}</span>{" "}
                    <span className="font-mono text-[12.5px]">&lt;{fromEmail.trim() || "noreply@example.com"}&gt;</span>
                  </span>
                }
              >
                <SettingsRow label="From name" htmlFor="smtp-from-name">
                  <TextInput
                    id="smtp-from-name"
                    value={fromName}
                    onChange={(event) => setFromName(event.currentTarget.value)}
                  />
                </SettingsRow>
                <SettingsRow label="From address" htmlFor="smtp-from-email" required={enabled}>
                  <TextInput
                    id="smtp-from-email"
                    type="email"
                    value={fromEmail}
                    onChange={(event) => setFromEmail(event.currentTarget.value)}
                    placeholder="noreply@example.com"
                  />
                </SettingsRow>
                <SettingsRow
                  label="Send a test"
                  htmlFor="smtp-test-to"
                  description="Uses the values above, including unsaved edits."
                >
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <TextInput
                      id="smtp-test-to"
                      className="flex-1"
                      type="email"
                      value={testTo}
                      onChange={(event) => setTestTo(event.currentTarget.value)}
                      placeholder="you@example.com"
                    />
                    <Button
                      type="button"
                      variant="default"
                      loading={testing}
                      disabled={!testTo.trim() || !host.trim()}
                      leftSection={<Send className="size-3.5" />}
                      onClick={() => void onTest()}
                    >
                      Send test
                    </Button>
                  </div>
                </SettingsRow>
              </SettingsCard>

              <button type="submit" hidden aria-hidden tabIndex={-1} />
            </form>
          ) : null}

          {section === "sso" ? (
            <form id={FORM_ID.sso} className="space-y-5" onSubmit={(event) => void onSaveOidc(event)} noValidate>
              <SettingsCard
                title="Sign-in methods"
                footer={
                  oidc?.source === "env" ? (
                    <EnvNote>OIDC variables in the server environment are in use. Saving here takes over.</EnvNote>
                  ) : oidc?.envFallback && !oidcEnabled ? (
                    <EnvNote>The server environment still has OIDC variables as a fallback.</EnvNote>
                  ) : undefined
                }
              >
                <SettingsToggleRow
                  title="Email and password"
                  description="Turn off to require SSO for everyone after the first admin account exists."
                  control={
                    <Switch
                      checked={oidcPasswordLogin}
                      onChange={(event) => setOidcPasswordLogin(event.currentTarget.checked)}
                      aria-label="Allow email and password sign-in"
                    />
                  }
                />
                <SettingsToggleRow
                  title="Single sign-on (OpenID Connect)"
                  description="Adds a sign-in button for your identity provider: Authentik, Keycloak, Entra ID, Google and others."
                  control={
                    <Switch
                      checked={oidcEnabled}
                      onChange={(event) => setOidcEnabled(event.currentTarget.checked)}
                      aria-label="Enable single sign-on"
                    />
                  }
                />
                {signInLocked ? (
                  <div className="flex items-start gap-2 border-l-2 border-status-error bg-status-error/10 px-5 py-3 text-sm text-status-error sm:px-6">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    With both methods off, nobody will be able to sign in.
                  </div>
                ) : null}
              </SettingsCard>

              {/* Provider details only matter once SSO is on (or already configured). */}
              {oidcEnabled || oidc?.configured ? (
                <SettingsCard
                  title="Identity provider"
                  description="Copy these values from the OAuth / OIDC application in your provider."
                >
                  <SettingsRow
                    label="Redirect URI"
                    description="Register this exact URL as an allowed callback on your provider."
                  >
                    <CopyField
                      value={oidc?.redirectUri ?? ""}
                      copied={copiedUri}
                      onCopy={() => void copyRedirect()}
                      label="Copy redirect URI"
                    />
                  </SettingsRow>
                  <SettingsRow label="Issuer URL" htmlFor="oidc-issuer" required={oidcEnabled}>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <TextInput
                        id="oidc-issuer"
                        className="flex-1"
                        value={oidcIssuer}
                        onChange={(event) => setOidcIssuer(event.currentTarget.value)}
                        placeholder="https://auth.example.com/application/o/flutter/"
                        autoComplete="off"
                      />
                      <Button
                        type="button"
                        variant="default"
                        loading={oidcTesting}
                        disabled={!oidcIssuer.trim()}
                        onClick={() => void onTestOidc()}
                      >
                        Test
                      </Button>
                    </div>
                  </SettingsRow>
                  <SettingsRow label="Client ID" htmlFor="oidc-client-id" required={oidcEnabled}>
                    <TextInput
                      id="oidc-client-id"
                      value={oidcClientId}
                      onChange={(event) => setOidcClientId(event.currentTarget.value)}
                      autoComplete="off"
                    />
                  </SettingsRow>
                  <SettingsRow
                    label="Client secret"
                    htmlFor="oidc-client-secret"
                    description={oidc?.clientSecretSet ? "Leave blank to keep the saved secret." : undefined}
                  >
                    <PasswordInput
                      id="oidc-client-secret"
                      value={oidcClientSecret}
                      onChange={(event) => setOidcClientSecret(event.currentTarget.value)}
                      autoComplete="new-password"
                      placeholder={oidc?.clientSecretSet ? "••••••••" : ""}
                    />
                  </SettingsRow>
                  <SettingsRow label="Scopes" htmlFor="oidc-scopes" description="Space-separated. The default works for most providers.">
                    <TextInput
                      id="oidc-scopes"
                      value={oidcScopes}
                      onChange={(event) => setOidcScopes(event.currentTarget.value)}
                      placeholder={DEFAULT_SSO_SCOPES}
                    />
                  </SettingsRow>
                  <SettingsRow label="Button label" htmlFor="oidc-button-label" description="Text on the login page button.">
                    <TextInput
                      id="oidc-button-label"
                      value={oidcButtonLabel}
                      onChange={(event) => setOidcButtonLabel(event.currentTarget.value)}
                      placeholder={DEFAULT_SSO_LABEL}
                      leftSection={<KeyRound className="size-3.5" />}
                    />
                  </SettingsRow>
                  <SettingsRow
                    label="Allowed email domains"
                    htmlFor="oidc-domains"
                    description="Comma-separated. Leave blank to allow any domain."
                  >
                    <TextInput
                      id="oidc-domains"
                      value={oidcDomains}
                      onChange={(event) => setOidcDomains(event.currentTarget.value)}
                      placeholder="company.com"
                    />
                  </SettingsRow>
                </SettingsCard>
              ) : null}

              <button type="submit" hidden aria-hidden tabIndex={-1} />
            </form>
          ) : null}

          {section === "telemetry" ? (
            <TelemetrySection telemetry={telemetry} pending={telemetryPending} onSave={onSaveTelemetry} />
          ) : null}

          {formId ? (
            <UnsavedChangesBar
              visible={Boolean(dirtyBySection[section])}
              formId={formId}
              saving={saving}
              onDiscard={() => discard(section)}
            />
          ) : null}
        </SettingsWorkspace>
      )}
    </AdminPage>
  );
}

/** Amber note for settings currently coming from the server environment (.env). */
function EnvNote({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-start gap-2 text-status-warn">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </span>
  );
}
