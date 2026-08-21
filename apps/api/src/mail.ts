import nodemailer from "nodemailer";
import type { SmtpEncryption } from "@flutter-software/shared";
import { env } from "./env";
import { log } from "./log";
import { PanelSettings } from "./db/models";

export type SmtpConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  encryption: SmtpEncryption;
  fromEmail: string;
  fromName: string;
  source: "database" | "env";
};

function asEncryption(value: unknown, fallback: SmtpEncryption = "starttls"): SmtpEncryption {
  if (value === "none" || value === "starttls" || value === "tls") return value;
  return fallback;
}

export async function resolveSmtp(): Promise<SmtpConfig | null> {
  const row = await PanelSettings.findOne({ key: "panel" });
  const smtp = row?.smtp as
    | {
        enabled?: boolean;
        host?: string;
        port?: number;
        username?: string;
        password?: string;
        encryption?: string;
        fromEmail?: string;
        fromName?: string;
      }
    | undefined;
  if (smtp?.enabled && smtp.host?.trim()) {
    return {
      host: smtp.host.trim(),
      port: smtp.port || 587,
      username: smtp.username?.trim() ?? "",
      password: smtp.password ?? "",
      encryption: asEncryption(smtp.encryption),
      fromEmail: (smtp.fromEmail || smtp.username || "").trim(),
      fromName: smtp.fromName?.trim() || (typeof row?.siteName === "string" && row.siteName.trim()) || "Flutter",
      source: "database",
    };
  }

  const cfg = env();
  if (!cfg.SMTP_HOST) return null;
  const port = cfg.SMTP_PORT ?? 587;
  return {
    host: cfg.SMTP_HOST,
    port,
    username: cfg.SMTP_USER ?? "",
    password: cfg.SMTP_PASS ?? "",
    encryption: port === 465 ? "tls" : "starttls",
    fromEmail: cfg.SMTP_FROM || cfg.SMTP_USER || "noreply@localhost",
    fromName: (typeof row?.siteName === "string" && row.siteName.trim()) || "Flutter",
    source: "env",
  };
}

function transportOptions(config: SmtpConfig) {
  return {
    host: config.host,
    port: config.port,
    secure: config.encryption === "tls",
    requireTLS: config.encryption === "starttls",
    auth: config.username ? { user: config.username, pass: config.password } : undefined,
  };
}

function fromHeader(config: SmtpConfig) {
  const email = config.fromEmail || config.username || "noreply@localhost";
  const name = config.fromName.trim();
  return name ? `${name} <${email}>` : email;
}

export async function sendMail(
  options: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  },
  override?: SmtpConfig | null,
) {
  const config = override === undefined ? await resolveSmtp() : override;
  if (!config) {
    log("info", "smtp not configured; email not sent", { to: options.to, subject: options.subject });
    return false;
  }
  const transport = nodemailer.createTransport(transportOptions(config));
  await transport.sendMail({
    from: fromHeader(config),
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
  });
  return true;
}

export async function verifySmtp(config: SmtpConfig) {
  const transport = nodemailer.createTransport(transportOptions(config));
  await transport.verify();
}

export async function sendSubuserInvite(options: {
  to: string;
  serverName: string;
  inviterName: string;
  url: string;
}) {
  const settings = await PanelSettings.findOne({ key: "panel" });
  const siteName = (typeof settings?.siteName === "string" && settings.siteName.trim()) || "Flutter";
  const subject = `You're invited to ${options.serverName} on ${siteName}`;
  const text = [
    `${options.inviterName} added you as a subuser on ${options.serverName}.`,
    "",
    "Set up your account (link expires in 7 days):",
    options.url,
  ].join("\n");
  const html = `
    <p>${escapeHtml(options.inviterName)} added you as a subuser on <strong>${escapeHtml(options.serverName)}</strong>.</p>
    <p><a href="${escapeHtml(options.url)}">Set up your account</a> — this link expires in 7 days.</p>
  `;
  try {
    return await sendMail({ to: options.to, subject, text, html });
  } catch (error) {
    log("error", "invite email failed", {
      to: options.to,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
