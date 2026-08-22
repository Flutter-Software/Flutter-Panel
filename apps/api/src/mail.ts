import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import {
  PERMISSION_GROUPS,
  hasServerPermission,
  type ServerPermission,
  type SmtpEncryption,
} from "@flutter-software/shared";
import { env } from "./env";
import { log } from "./log";
import { PanelSettings } from "./db/models";

const LOGO_CID = "flutter-logo@panel";
const LOGO_FILE = "apps/web/public/flutter-logo.png";

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
    attachments?: {
      filename: string;
      content: Buffer;
      contentType: string;
      cid?: string;
      contentDisposition?: "inline" | "attachment";
    }[];
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
    attachments: options.attachments,
  });
  return true;
}

export async function verifySmtp(config: SmtpConfig) {
  const transport = nodemailer.createTransport(transportOptions(config));
  await transport.verify();
}

function logoCandidates() {
  const here = dirname(fileURLToPath(import.meta.url));
  const cwd = process.cwd();
  return [
    resolve(here, "../../../", LOGO_FILE),
    resolve(cwd, LOGO_FILE),
    resolve(cwd, "../web/public/flutter-logo.png"),
    resolve(here, "../../web/public/flutter-logo.png"),
  ];
}

async function loadInviteLogo() {
  for (const path of logoCandidates()) {
    if (!existsSync(path)) continue;
    try {
      const data = await readFile(path);
      if (!data.byteLength) continue;
      return { data, mime: "image/png", filename: "flutter-logo.png" };
    } catch {
      /* try next */
    }
  }
  log("warn", "invite logo missing", { tried: logoCandidates() });
  return null;
}

const INVITE_PERMISSIONS: { label: string; group: string }[] = [
  { label: "Console", group: "control" },
  { label: "File manager", group: "files" },
  { label: "Backups", group: "backups" },
  { label: "Schedules", group: "schedules" },
  { label: "Startup", group: "startup" },
  { label: "Settings", group: "settings" },
];

export type SubuserInviteMail = {
  to: string;
  serverName: string;
  inviterName: string;
  url: string;
  nodeName?: string;
  address?: string;
  online?: boolean;
  permissions?: readonly string[];
};

export async function sendSubuserInvite(options: SubuserInviteMail) {
  const settings = await PanelSettings.findOne({ key: "panel" });
  const siteName = (typeof settings?.siteName === "string" && settings.siteName.trim()) || "Flutter";
  const appUrl = env().APP_URL.replace(/\/+$/, "");
  const subject = `You're invited to ${options.serverName} on ${siteName}`;
  const granted = options.permissions ?? [];
  const enabledLabels = INVITE_PERMISSIONS.filter((row) => permissionGroupGranted(granted, row.group)).map(
    (row) => row.label,
  );
  const text = [
    `${options.inviterName} has added you as a subuser on their ${siteName} game server.`,
    "",
    `Server: ${options.serverName}`,
    options.nodeName || options.address
      ? [options.nodeName, options.address].filter(Boolean).join(" • ")
      : "",
    enabledLabels.length ? `Permissions: ${enabledLabels.join(", ")}` : "",
    "",
    "Accept the invitation (link expires in 7 days):",
    options.url,
  ]
    .filter((line) => line !== "")
    .join("\n");
  const logo = await loadInviteLogo();
  const html = subuserInviteHtml({
    ...options,
    siteName,
    panelUrl: appUrl,
    logoUrl: logo ? `cid:${LOGO_CID}` : `${appUrl}/flutter-logo.png`,
  });
  try {
    return await sendMail({
      to: options.to,
      subject,
      text,
      html,
      attachments: logo
        ? [
            {
              filename: logo.filename,
              content: logo.data,
              contentType: logo.mime,
              cid: LOGO_CID,
              contentDisposition: "inline",
            },
          ]
        : undefined,
    });
  } catch (error) {
    log("error", "invite email failed", {
      to: options.to,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function permissionGroupGranted(granted: readonly string[], group: string) {
  if (granted.includes("*")) return true;
  if (group === "schedules") return hasServerPermission(granted, "schedule.read");
  const found = PERMISSION_GROUPS.find((row) => row.key === group);
  if (!found) return hasServerPermission(granted, group as ServerPermission);
  return found.permissions.some((permission) => hasServerPermission(granted, permission.key));
}

function subuserInviteHtml(options: SubuserInviteMail & { siteName: string; panelUrl: string; logoUrl: string }) {
  const year = new Date().getFullYear();
  const inviter = escapeHtml(options.inviterName);
  const serverName = escapeHtml(options.serverName);
  const siteName = escapeHtml(options.siteName);
  const url = escapeHtml(options.url);
  const panelUrl = escapeHtml(options.panelUrl);
  const nodeName = escapeHtml(options.nodeName?.trim() || "");
  const address = escapeHtml(options.address?.trim() || "");
  const meta = [nodeName, address].filter(Boolean).join(" • ");
  const granted = options.permissions ?? [];
  const online = Boolean(options.online);
  const statusColor = online ? "#4ade80" : "#6b7280";
  const statusLabel = online ? "Online" : "Offline";
  const logo = `<img src="${escapeHtml(options.logoUrl)}" alt="${siteName}" width="36" height="36" style="display:block;width:36px;height:36px;border-radius:8px;border:0;background:#0a0a0a;" />`;

  const permissionCells = INVITE_PERMISSIONS.map((row) => {
    const enabled = permissionGroupGranted(granted, row.group);
    const color = enabled ? "#ffffff" : "#6b7280";
    return `
      <td width="50%" valign="top" style="padding:0 8px 12px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="3" height="14" bgcolor="#3bb2f6" style="width:3px;height:14px;background:#3bb2f6;font-size:0;line-height:14px;border-radius:2px;">&nbsp;</td>
            <td style="padding-left:10px;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:${color};font-weight:500;">${escapeHtml(row.label)}</td>
          </tr>
        </table>
      </td>`;
  });
  const permissionRows: string[] = [];
  for (let i = 0; i < permissionCells.length; i += 2) {
    permissionRows.push(`<tr>${permissionCells[i]}${permissionCells[i + 1] ?? `<td width="50%"></td>`}</tr>`);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${siteName} invitation</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">You've been invited to manage ${serverName}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0a;">
    <tr>
      <td align="center" style="padding:36px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
          <tr>
            <td style="padding-bottom:20px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="middle" style="padding-right:12px;">${logo}</td>
                  <td valign="middle">
                    <div style="font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:18px;line-height:22px;color:#ffffff;font-weight:700;">${siteName}</div>
                    <div style="font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:16px;color:#9ca3af;letter-spacing:0.14em;text-transform:uppercase;padding-top:2px;">Control Panel</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="height:2px;line-height:2px;font-size:0;background:#3bb2f6;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding-top:20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#1a1a1a;border:1px solid #262626;border-radius:12px;">
                <tr>
                  <td style="padding:28px 28px 24px 28px;">
                    <span style="display:inline-block;padding:4px 10px;background:#12324a;color:#7dd3fc;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;border-radius:999px;">Server invitation</span>
                    <h1 style="margin:16px 0 12px 0;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:26px;line-height:32px;color:#ffffff;font-weight:700;">You've been invited to manage a server</h1>
                    <p style="margin:0 0 22px 0;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#a0a0a0;"><strong style="color:#ffffff;font-weight:600;">${inviter}</strong> has added you as a subuser on their ${siteName} game server. Accept the invite to access the console, files, and more.</p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#121212;border:1px solid #262626;border-radius:10px;">
                      <tr>
                        <td style="padding:16px 18px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td valign="middle">
                                <div style="font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:22px;color:#ffffff;font-weight:700;">${serverName}</div>
                                ${meta ? `<div style="padding-top:4px;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:18px;color:#a0a0a0;">${meta}</div>` : ""}
                              </td>
                              <td valign="middle" align="right" width="90" style="white-space:nowrap;">
                                <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${statusColor};vertical-align:middle;"></span>
                                <span style="padding-left:6px;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:18px;color:${statusColor};font-weight:600;vertical-align:middle;">${statusLabel}</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:22px 0 10px 0;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:16px;color:#6b7280;letter-spacing:0.12em;text-transform:uppercase;font-weight:600;">Your permissions</p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      ${permissionRows.join("")}
                    </table>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">
                      <tr>
                        <td align="center" bgcolor="#3bb2f6" style="background:#3bb2f6;border-radius:10px;">
                          <a href="${url}" style="display:block;padding:14px 20px;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:20px;color:#0a0a0a;font-weight:700;text-decoration:none;">Accept invitation</a>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:14px 0 0 0;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#a0a0a0;text-align:center;">Or paste this link into your browser:<br /><a href="${url}" style="color:#3bb2f6;text-decoration:none;word-break:break-all;">${url}</a></p>
                    <div style="margin:22px 0 0 0;border-top:1px solid #2a2a2a;padding-top:16px;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#a0a0a0;">This invitation expires in <strong style="color:#ffffff;font-weight:600;">7 days</strong>. If you weren't expecting it, you can ignore this email.</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 12px 0 12px;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:20px;color:#606060;">
              Sent by ${siteName} Control Panel on behalf of ${inviter}.<br />
              &copy; ${year} ${siteName}. All rights reserved.<br />
              <a href="${panelUrl}" style="color:#606060;text-decoration:underline;">Help center</a>
              &nbsp;&middot;&nbsp;
              <a href="${panelUrl}" style="color:#606060;text-decoration:underline;">Privacy</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
