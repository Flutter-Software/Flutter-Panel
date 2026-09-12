import {
  FlutterError,
  brandingUpdateSchema,
  DEFAULT_CONSOLE_TAG,
  oidcSettingsSchema,
  smtpSettingsSchema,
  smtpTestSchema,
  normalizeConsoleTag,
  type SmtpEncryption,
} from "@flutter-software/shared";
import { PanelSettings } from "./db/models";
import { env } from "./env";
import { resolveSmtp, sendMail, verifySmtp, type SmtpConfig } from "./mail";

const KEY = "panel";
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_SITE_NAME = "Flutter";
const DEFAULT_OIDC_LABEL = "Sign in with SSO";
const DEFAULT_OIDC_SCOPES = "openid email profile";

type SmtpFields = {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  encryption: SmtpEncryption;
  fromEmail: string;
  fromName: string;
};

function emptySmtp(): SmtpFields {
  return {
    enabled: false,
    host: "",
    port: 587,
    username: "",
    password: "",
    encryption: "starttls",
    fromEmail: "",
    fromName: "Flutter",
  };
}

function fromDoc(smtp: Record<string, unknown> | undefined | null): SmtpFields {
  const base = emptySmtp();
  if (!smtp) return base;
  return {
    enabled: Boolean(smtp.enabled),
    host: String(smtp.host ?? ""),
    port: typeof smtp.port === "number" && smtp.port > 0 ? smtp.port : 587,
    username: String(smtp.username ?? ""),
    password: String(smtp.password ?? ""),
    encryption:
      smtp.encryption === "none" || smtp.encryption === "tls" || smtp.encryption === "starttls"
        ? smtp.encryption
        : "starttls",
    fromEmail: String(smtp.fromEmail ?? ""),
    fromName: String(smtp.fromName ?? "Flutter") || "Flutter",
  };
}

function publicSmtp(smtp: SmtpFields, resolved: SmtpConfig | null) {
  return {
    enabled: smtp.enabled,
    host: smtp.host,
    port: smtp.port,
    username: smtp.username,
    passwordSet: Boolean(smtp.password),
    encryption: smtp.encryption,
    fromEmail: smtp.fromEmail,
    fromName: smtp.fromName,
    configured: Boolean(resolved),
    source: resolved?.source ?? (smtp.enabled && smtp.host ? "database" : "none"),
    envFallback: Boolean(env().SMTP_HOST),
  };
}

async function loadRow() {
  let row = await PanelSettings.findOne({ key: KEY });
  if (!row) {
    row = await PanelSettings.create({ key: KEY, smtp: emptySmtp(), siteName: DEFAULT_SITE_NAME });
  }
  return row;
}

function siteNameOf(row: { siteName?: string | null } | null | undefined) {
  const name = row?.siteName?.trim();
  return name || DEFAULT_SITE_NAME;
}

function consoleTagOf(row: { consoleTag?: string | null } | null | undefined) {
  return normalizeConsoleTag(row?.consoleTag);
}

function decodeLogoData(raw: string) {
  const comma = raw.indexOf(",");
  const payload = comma >= 0 ? raw.slice(comma + 1) : raw;
  const buffer = Buffer.from(payload, "base64");
  if (!buffer.length) throw FlutterError.validation("Logo file is empty");
  if (buffer.length > LOGO_MAX_BYTES) throw FlutterError.validation("Logo must be 2 MB or smaller");
  return buffer;
}

function logoBuffer(value: unknown): Buffer | null {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value.byteLength ? value : null;
  if (value instanceof Uint8Array) return value.byteLength ? Buffer.from(value) : null;
  return null;
}

function brandingDto(row: {
  siteName?: string | null;
  consoleTag?: string | null;
  logo?: unknown;
  logoMime?: string | null;
  updatedAt?: Date;
}) {
  const logo = logoBuffer(row.logo);
  const hasLogo = Boolean(logo && row.logoMime);
  const version = row.updatedAt ? row.updatedAt.getTime() : Date.now();
  return {
    siteName: siteNameOf(row),
    consoleTag: consoleTagOf(row),
    hasLogo,
    logoUrl: hasLogo ? `/api/v1/branding/logo?v=${version}` : null,
  };
}

export type OidcFields = {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  buttonLabel: string;
  scopes: string;
  allowedDomains: string;
  passwordLogin: boolean;
};

export type ResolvedOidc = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  buttonLabel: string;
  scopes: string;
  allowedDomains: string[];
  passwordLogin: boolean;
  source: "database" | "env";
};

function emptyOidc(): OidcFields {
  return {
    enabled: false,
    issuer: "",
    clientId: "",
    clientSecret: "",
    buttonLabel: DEFAULT_OIDC_LABEL,
    scopes: DEFAULT_OIDC_SCOPES,
    allowedDomains: "",
    passwordLogin: true,
  };
}

function fromOidcDoc(oidc: Record<string, unknown> | undefined | null): OidcFields {
  const base = emptyOidc();
  if (!oidc) return base;
  return {
    enabled: Boolean(oidc.enabled),
    issuer: String(oidc.issuer ?? ""),
    clientId: String(oidc.clientId ?? ""),
    clientSecret: String(oidc.clientSecret ?? ""),
    buttonLabel: String(oidc.buttonLabel ?? "").trim() || DEFAULT_OIDC_LABEL,
    scopes: String(oidc.scopes ?? "").trim() || DEFAULT_OIDC_SCOPES,
    allowedDomains: String(oidc.allowedDomains ?? ""),
    passwordLogin: oidc.passwordLogin !== false,
  };
}

export function parseAllowedDomains(value: string) {
  return value
    .split(/[,\s]+/)
    .map((part) => part.replace(/^@/, "").trim().toLowerCase())
    .filter(Boolean);
}

export function oidcRedirectUri() {
  return `${env().APP_URL.replace(/\/+$/, "")}/api/v1/auth/oidc/callback`;
}

async function oidcFromDatabase(): Promise<OidcFields> {
  const row = await PanelSettings.findOne({ key: KEY });
  return fromOidcDoc(row?.oidc as Record<string, unknown> | undefined);
}

export async function resolveOidc(): Promise<ResolvedOidc | null> {
  const stored = await oidcFromDatabase();
  if (stored.enabled && stored.issuer.trim() && stored.clientId.trim() && stored.clientSecret) {
    return {
      issuer: stored.issuer.trim(),
      clientId: stored.clientId.trim(),
      clientSecret: stored.clientSecret,
      buttonLabel: stored.buttonLabel,
      scopes: stored.scopes,
      allowedDomains: parseAllowedDomains(stored.allowedDomains),
      passwordLogin: stored.passwordLogin,
      source: "database",
    };
  }

  const cfg = env();
  if (!cfg.OIDC_ISSUER || !cfg.OIDC_CLIENT_ID || !cfg.OIDC_CLIENT_SECRET) return null;
  return {
    issuer: cfg.OIDC_ISSUER,
    clientId: cfg.OIDC_CLIENT_ID,
    clientSecret: cfg.OIDC_CLIENT_SECRET,
    buttonLabel: stored.buttonLabel,
    scopes: stored.scopes,
    allowedDomains: parseAllowedDomains(stored.allowedDomains),
    passwordLogin: stored.passwordLogin,
    source: "env",
  };
}

function publicOidcDto(stored: OidcFields, resolved: ResolvedOidc | null) {
  return {
    enabled: stored.enabled,
    issuer: stored.issuer,
    clientId: stored.clientId,
    clientSecretSet: Boolean(stored.clientSecret),
    buttonLabel: stored.buttonLabel,
    scopes: stored.scopes,
    allowedDomains: stored.allowedDomains,
    passwordLogin: stored.passwordLogin,
    redirectUri: oidcRedirectUri(),
    configured: Boolean(resolved),
    source: resolved?.source ?? (stored.enabled && stored.issuer ? "database" : "none"),
    envFallback: Boolean(env().OIDC_ISSUER),
  };
}

export async function publicOidc() {
  const stored = await oidcFromDatabase();
  const resolved = await resolveOidc();
  return {
    enabled: Boolean(resolved),
    buttonLabel: stored.buttonLabel,
    passwordLogin: stored.passwordLogin,
  };
}

export async function getSiteName() {
  const row = await PanelSettings.findOne({ key: KEY });
  return siteNameOf(row);
}

export async function getConsoleTag() {
  const row = await PanelSettings.findOne({ key: KEY });
  return consoleTagOf(row);
}

export async function getPublicBranding() {
  const row = await PanelSettings.findOne({ key: KEY });
  return brandingDto(row ?? { siteName: DEFAULT_SITE_NAME, consoleTag: DEFAULT_CONSOLE_TAG });
}

export async function getLogo() {
  const row = await PanelSettings.findOne({ key: KEY });
  const data = logoBuffer(row?.logo);
  if (!data || !row?.logoMime) return null;
  return { mime: String(row.logoMime), data };
}

export async function getSettings() {
  const row = await loadRow();
  const smtp = fromDoc(row.smtp as Record<string, unknown> | undefined);
  const oidc = fromOidcDoc(row.oidc as Record<string, unknown> | undefined);
  const resolved = await resolveSmtp();
  const oidcResolved = await resolveOidc();
  return {
    smtp: publicSmtp(smtp, resolved),
    oidc: publicOidcDto(oidc, oidcResolved),
    branding: brandingDto(row),
  };
}

export async function updateSettings(body: unknown) {
  const parsed = smtpSettingsSchema.safeParse(body);
  if (!parsed.success) throw FlutterError.validation("Invalid SMTP settings", parsed.error.flatten());
  const row = await loadRow();
  const current = fromDoc(row.smtp as Record<string, unknown> | undefined);
  const next: SmtpFields = {
    enabled: parsed.data.enabled,
    host: parsed.data.host.trim(),
    port: parsed.data.port,
    username: parsed.data.username.trim(),
    password: parsed.data.password ? parsed.data.password : current.password,
    encryption: parsed.data.encryption,
    fromEmail: parsed.data.fromEmail.trim(),
    fromName: parsed.data.fromName.trim() || "Flutter",
  };
  row.smtp = next;
  row.markModified("smtp");
  await row.save();
  const resolved = await resolveSmtp();
  const oidcResolved = await resolveOidc();
  return {
    smtp: publicSmtp(next, resolved),
    oidc: publicOidcDto(fromOidcDoc(row.oidc as Record<string, unknown> | undefined), oidcResolved),
    branding: brandingDto(row),
  };
}

export async function updateOidc(body: unknown) {
  const parsed = oidcSettingsSchema.safeParse(body);
  if (!parsed.success) throw FlutterError.validation("Invalid SSO settings", parsed.error.flatten());
  const row = await loadRow();
  const current = fromOidcDoc(row.oidc as Record<string, unknown> | undefined);
  const next: OidcFields = {
    enabled: parsed.data.enabled,
    issuer: parsed.data.issuer.trim(),
    clientId: parsed.data.clientId.trim(),
    clientSecret: parsed.data.clientSecret ? parsed.data.clientSecret : current.clientSecret,
    buttonLabel: parsed.data.buttonLabel.trim() || DEFAULT_OIDC_LABEL,
    scopes: parsed.data.scopes.trim() || DEFAULT_OIDC_SCOPES,
    allowedDomains: parsed.data.allowedDomains.trim(),
    passwordLogin: parsed.data.passwordLogin,
  };
  if (next.enabled && !next.clientSecret) {
    throw FlutterError.validation("Client secret is required", { fieldErrors: { clientSecret: ["Client secret is required"] } });
  }
  row.oidc = next;
  row.markModified("oidc");
  await row.save();
  const resolved = await resolveOidc();
  return { oidc: publicOidcDto(next, resolved) };
}

export async function updateBranding(body: unknown) {
  const parsed = brandingUpdateSchema.safeParse(body);
  if (!parsed.success) throw FlutterError.validation("Invalid branding", parsed.error.flatten());
  const row = await loadRow();
  row.siteName = parsed.data.siteName.trim() || DEFAULT_SITE_NAME;
  if (parsed.data.consoleTag) row.consoleTag = parsed.data.consoleTag;
  if (parsed.data.logo === null) {
    row.logo = null;
    row.logoMime = null;
  } else if (parsed.data.logo) {
    row.logo = decodeLogoData(parsed.data.logo.data);
    row.logoMime = parsed.data.logo.mime;
  }
  await row.save();
  return { branding: brandingDto(row) };
}

export async function testSmtp(body: unknown) {
  const parsed = smtpTestSchema.safeParse(body);
  if (!parsed.success) throw FlutterError.validation("Invalid test email", parsed.error.flatten());
  const row = await loadRow();
  const stored = fromDoc(row.smtp as Record<string, unknown> | undefined);
  const merged: SmtpFields = {
    enabled: parsed.data.enabled ?? stored.enabled,
    host: (parsed.data.host ?? stored.host).trim(),
    port: parsed.data.port ?? stored.port,
    username: (parsed.data.username ?? stored.username).trim(),
    password: parsed.data.password ? parsed.data.password : stored.password,
    encryption: parsed.data.encryption ?? stored.encryption,
    fromEmail: (parsed.data.fromEmail ?? stored.fromEmail).trim(),
    fromName: (parsed.data.fromName ?? stored.fromName).trim() || "Flutter",
  };

  let config: SmtpConfig | null = null;
  if (merged.host) {
    config = {
      host: merged.host,
      port: merged.port,
      username: merged.username,
      password: merged.password,
      encryption: merged.encryption,
      fromEmail: merged.fromEmail || merged.username,
      fromName: merged.fromName,
      source: "database",
    };
  } else {
    config = await resolveSmtp();
  }
  if (!config) {
    throw FlutterError.validation("SMTP is not configured. Save a host first, or set SMTP_HOST in the environment.");
  }

  try {
    await verifySmtp(config);
    await sendMail(
      {
        to: parsed.data.to,
        subject: `${siteNameOf(row)} SMTP test`,
        text: `This is a test message from ${siteNameOf(row)}. SMTP is working.`,
        html: `<p>This is a test message from ${siteNameOf(row)}. SMTP is working.</p>`,
      },
      config,
    );
  } catch (error) {
    throw FlutterError.unavailable(error instanceof Error ? error.message : "SMTP test failed");
  }
  return { ok: true, to: parsed.data.to };
}
