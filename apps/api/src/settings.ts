import { FlutterError, smtpSettingsSchema, smtpTestSchema, type SmtpEncryption } from "@flutter-software/shared";
import { PanelSettings } from "./db/models";
import { env } from "./env";
import { resolveSmtp, sendMail, verifySmtp, type SmtpConfig } from "./mail";

const KEY = "panel";

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
    row = await PanelSettings.create({ key: KEY, smtp: emptySmtp() });
  }
  return row;
}

export async function getSettings() {
  const row = await loadRow();
  const smtp = fromDoc(row.smtp as Record<string, unknown> | undefined);
  const resolved = await resolveSmtp();
  return { smtp: publicSmtp(smtp, resolved) };
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
  return { smtp: publicSmtp(next, resolved) };
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
        subject: "Flutter SMTP test",
        text: "This is a test message from your Flutter panel. SMTP is working.",
        html: "<p>This is a test message from your Flutter panel. SMTP is working.</p>",
      },
      config,
    );
  } catch (error) {
    throw FlutterError.unavailable(error instanceof Error ? error.message : "SMTP test failed");
  }
  return { ok: true, to: parsed.data.to };
}
