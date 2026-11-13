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
  Check,
  Copy,
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
import { UpdatesSection } from "./updates-section";
import { IdentityStudio } from "./identity-studio";
import { TelemetrySection, type TelemetryPublic } from "./telemetry-section";
import {
  parseSettingsSection,
  SettingsCard,
  SettingsSegmented,
  SettingsToggleRow,
  SettingsWorkspace,
  UnsavedChangesBar,
  type SettingsNavGroup,
  type SettingsSection,
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

type UpdateStatus = {
  version: string;
  updateAvailable: boolean;
  checkError: string | null;
  job: { state: string };
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
  const updates = useQuery<{ data: UpdateStatus }>("/api/v1/admin/settings/update");
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

  const update = updates.data?.data;
  const updateState: { tone: SettingsTone; status: string } =
    update?.job.state === "running"
      ? { tone: "info", status: "Updating" }
      : update?.updateAvailable
        ? { tone: "warn", status: "Update available" }
        : update?.checkError
          ? { tone: "warn", status: "Check failed" }
          : update
            ? { tone: "ok", status: `Up to date · v${update.version}` }
            : { tone: "off", status: "Checking…" };

  const mailState: { tone: SettingsTone; status: string } =
    smtp?.source === "database"
      ? { tone: "ok", status: "Active" }
      : smtp?.source === "env"
        ? { tone: "warn", status: "Using environment" }
        : smtp?.envFallback
          ? { tone: "warn", status: "Off · env fallback" }
          : { tone: "off", status: "Not configured" };

  const ssoState: { tone: SettingsTone; status: string } =
    oidc?.source === "database"
      ? { tone: "ok", status: oidc.passwordLogin ? "SSO + passwords" : "SSO only" }
      : oidc?.source === "env"
        ? { tone: "warn", status: "Using environment" }
        : { tone: "off", status: "Passwords only" };

  const telemetryState: { tone: SettingsTone; status: string } = telemetry?.envDisabled
    ? { tone: "off", status: "Disabled by host" }
    : telemetry?.sending
      ? { tone: "ok", status: "Sharing" }
      : telemetry?.enabled
        ? { tone: "warn", status: "On · not sending" }
        : { tone: "off", status: "Off" };

  const groups: SettingsNavGroup[] = [
    {
      label: "General",
      items: [{ id: "branding", label: "Branding", icon: <ImageIcon /> }],
    },
    {
      label: "Authentication",
      items: [
        { id: "sso", label: "Sign-in", icon: <KeyRound />, ...ssoState },
        { id: "mail", label: "Email", icon: <Mail />, ...mailState },
      ],
    },
    {
      label: "System",
      items: [
        { id: "updates", label: "Updates", icon: <RefreshCw />, ...updateState },
        { id: "telemetry", label: "Telemetry", icon: <Radio />, ...telemetryState },
      ],
    },
  ];

  const pane: Record<SettingsSection, { title: string; description: string }> = {
    branding: { title: "Branding", description: "How this panel presents itself to users and in server consoles." },
    updates: { title: "Updates", description: "Compare this install with the latest build and apply updates in place." },
    mail: { title: "Email", description: "How the panel sends invites, verification links, and password resets." },
    sso: { title: "Sign-in", description: "Let users sign in through your OpenID Connect identity provider." },
    telemetry: { title: "Telemetry", description: "Anonymous crash and usage reports that help improve Flutter." },
  };

  const previewSrc = logoPreview ?? (removeLogo ? DEFAULT_LOGO_SRC : branding?.logoUrl || DEFAULT_LOGO_SRC);
  const canResetLogo = Boolean(logoFile || (branding?.hasLogo && !removeLogo));
  const signInLocked = !oidcEnabled && !oidcPasswordLogin;
  const formId = FORM_ID[section];
  const saving = section === "branding" ? brandingPending : section === "mail" ? pending : oidcPending;

  return (
    <AdminPage
      className="max-w-6xl"
      title="Settings"
      description="Manage your panel's identity, sign-in, email delivery, and updates."
    >
      <AdminError message={loadError} />
      {!data && !loadError ? (
        <SettingsWorkspaceSkeleton />
      ) : (
        <SettingsWorkspace
          section={section}
          onSection={(id) => void selectSection(id)}
          groups={groups}
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

          {/* Kept mounted so a running update keeps streaming while you browse other sections. */}
          <div className={section === "updates" ? "block" : "hidden"}>
            <UpdatesSection framed={false} />
          </div>

          {section === "mail" ? (
            <form id={FORM_ID.mail} className="space-y-5" onSubmit={(event) => void onSave(event)} noValidate>
              <SettingsCard
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
                  title="Send email through SMTP"
                  description="Deliver invites, verification links, and password resets from this panel."
                  control={
                    <Switch
                      checked={enabled}
                      onChange={(event) => setEnabled(event.currentTarget.checked)}
                      aria-label="Send email through SMTP"
                    />
                  }
                />
              </SettingsCard>

              <SettingsCard title="SMTP server" description="Your mail provider's outgoing server.">
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
                  <TextInput
                    label="Host"
                    withAsterisk={enabled}
                    value={host}
                    onChange={(event) => setHost(event.currentTarget.value)}
                    placeholder="smtp.example.com"
                    autoComplete="off"
                    leftSection={<Globe className="size-3.5" />}
                  />
                  <NumberInput
                    label="Port"
                    withAsterisk={enabled}
                    min={1}
                    max={65535}
                    hideControls
                    value={port}
                    onChange={(value) => setPort(typeof value === "number" ? value : 587)}
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Encryption</p>
                  <SettingsSegmented
                    label="Encryption"
                    value={encryption}
                    options={ENCRYPTION_OPTIONS}
                    onChange={changeEncryption}
                  />
                  <p className="text-xs text-muted-foreground">
                    STARTTLS usually uses port 587, TLS/SSL uses 465. The port follows your choice.
                  </p>
                </div>
              </SettingsCard>

              <SettingsCard title="Authentication" description="Credentials for the SMTP server, if it requires them.">
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
              </SettingsCard>

              <SettingsCard
                title="Sender"
                description="Who emails appear to come from."
                footer={
                  <span className="min-w-0 truncate">
                    Recipients see{" "}
                    <span className="font-medium text-foreground">
                      {fromName.trim() || DEFAULT_SITE_NAME}
                    </span>{" "}
                    <span className="font-mono text-xs">&lt;{fromEmail.trim() || "noreply@example.com"}&gt;</span>
                  </span>
                }
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextInput
                    label="From name"
                    value={fromName}
                    onChange={(event) => setFromName(event.currentTarget.value)}
                  />
                  <TextInput
                    type="email"
                    label="From address"
                    withAsterisk={enabled}
                    value={fromEmail}
                    onChange={(event) => setFromEmail(event.currentTarget.value)}
                    placeholder="noreply@example.com"
                  />
                </div>
              </SettingsCard>

              <SettingsCard
                title="Send a test email"
                description="Uses the values above, including unsaved edits, so you can verify before saving."
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <TextInput
                    className="flex-1"
                    type="email"
                    aria-label="Test recipient"
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
              </SettingsCard>

              <button type="submit" hidden aria-hidden tabIndex={-1} />
            </form>
          ) : null}

          {section === "sso" ? (
            <form id={FORM_ID.sso} className="space-y-5" onSubmit={(event) => void onSaveOidc(event)} noValidate>
              <SettingsCard
                footer={
                  oidc?.source === "env" ? (
                    <EnvNote>OIDC variables in the server environment are in use. Saving here takes over.</EnvNote>
                  ) : oidc?.envFallback && !oidcEnabled ? (
                    <EnvNote>The server environment still has OIDC variables as a fallback.</EnvNote>
                  ) : undefined
                }
              >
                <SettingsToggleRow
                  title="Enable single sign-on"
                  description="Adds a sign-in button to the login page once the provider below is configured."
                  control={
                    <Switch
                      checked={oidcEnabled}
                      onChange={(event) => setOidcEnabled(event.currentTarget.checked)}
                      aria-label="Enable single sign-on"
                    />
                  }
                />
                <div className="border-t border-border" />
                <SettingsToggleRow
                  title="Allow password sign-in"
                  description="Turn off to require SSO for everyone after the first admin account exists."
                  control={
                    <Switch
                      checked={oidcPasswordLogin}
                      onChange={(event) => setOidcPasswordLogin(event.currentTarget.checked)}
                      aria-label="Allow password sign-in"
                    />
                  }
                />
                {signInLocked ? (
                  <p className="flex items-start gap-2 rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    With both SSO and passwords off, nobody will be able to sign in.
                  </p>
                ) : null}
              </SettingsCard>

              <SettingsCard
                title="Redirect URI"
                description="Register this exact URL as an allowed callback on your identity provider."
              >
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs">
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
              </SettingsCard>

              <SettingsCard
                title="Identity provider"
                description="From your provider's OAuth / OIDC application (Authentik, Keycloak, Entra ID, Google…)."
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <TextInput
                    className="flex-1"
                    label="Issuer URL"
                    withAsterisk={oidcEnabled}
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
                    Test discovery
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextInput
                    label="Client ID"
                    withAsterisk={oidcEnabled}
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
                </div>
                <TextInput
                  label="Scopes"
                  description="Space-separated. The defaults work for most providers."
                  value={oidcScopes}
                  onChange={(event) => setOidcScopes(event.currentTarget.value)}
                  placeholder={DEFAULT_SSO_SCOPES}
                />
              </SettingsCard>

              <SettingsCard
                title="Login page"
                footer={
                  <span className="flex flex-wrap items-center gap-2">
                    Preview
                    <span className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground">
                      <KeyRound className="size-3.5" />
                      {oidcButtonLabel.trim() || DEFAULT_SSO_LABEL}
                    </span>
                  </span>
                }
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextInput
                    label="Button label"
                    value={oidcButtonLabel}
                    onChange={(event) => setOidcButtonLabel(event.currentTarget.value)}
                    placeholder={DEFAULT_SSO_LABEL}
                  />
                  <TextInput
                    label="Allowed email domains"
                    description="Comma-separated. Leave blank to allow any domain."
                    value={oidcDomains}
                    onChange={(event) => setOidcDomains(event.currentTarget.value)}
                    placeholder="company.com"
                  />
                </div>
              </SettingsCard>

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
