export const ACTIVITY_CATEGORIES = [
  "power",
  "files",
  "backups",
  "users",
  "settings",
  "startup",
  "databases",
  "schedules",
  "sftp",
  "network",
] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export const ACTIVITY_CATEGORY_META: { key: ActivityCategory; label: string }[] = [
  { key: "power", label: "Power" },
  { key: "files", label: "Files" },
  { key: "backups", label: "Backups" },
  { key: "users", label: "Users" },
  { key: "settings", label: "Settings" },
  { key: "startup", label: "Startup" },
  { key: "databases", label: "Databases" },
  { key: "schedules", label: "Schedules" },
  { key: "sftp", label: "SFTP" },
  { key: "network", label: "Network" },
];

export type ActivityActorKind = "user" | "system" | "schedule";

export const ACTIVITY_FILE_STACK_MS = 60_000;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

export function isActivityCategory(value: string): value is ActivityCategory {
  return (ACTIVITY_CATEGORIES as readonly string[]).includes(value);
}

export function describeActivity(event: string, properties: Record<string, unknown> = {}) {
  const path = text(properties.path);
  const to = text(properties.to);
  const name = text(properties.name);
  const email = text(properties.email);
  const names = list(properties.names);

  switch (event) {
    case "power.start":
      return "Started the server";
    case "power.stop":
      return "Stopped the server";
    case "power.restart":
      return "Restarted the server";
    case "power.kill":
      return "Killed the server";
    case "file.write":
      return path ? `Edited ${path}` : "Edited a file";
    case "file.mkdir":
      return path ? `Created folder ${path}` : "Created a folder";
    case "file.upload":
      return name || path ? `Uploaded ${name || path}` : "Uploaded a file";
    case "file.rename":
      if (path && to) return `Renamed ${path} to ${to}`;
      return path ? `Renamed ${path}` : "Renamed a file";
    case "file.delete":
      if (names.length > 1) return `Deleted ${names.length} items`;
      return path || names[0] ? `Deleted ${path || names[0]}` : "Deleted files";
    case "file.extract":
      return path ? `Extracted ${path}` : "Extracted an archive";
    case "file.compress":
      if (names.length > 1) return `Archived ${names.length} items`;
      return names[0] || path ? `Archived ${names[0] || path}` : "Created an archive";
    case "backup.create":
      return name ? `Created backup ${name}` : "Created a backup";
    case "backup.restore":
      return name ? `Restored backup ${name}` : "Restored a backup";
    case "backup.delete":
      return name ? `Deleted backup ${name}` : "Deleted a backup";
    case "user.create":
      return email ? `Added ${email} as a subuser` : "Added a subuser";
    case "user.update":
      return email ? `Updated permissions for ${email}` : "Updated a subuser";
    case "user.delete":
      return email ? `Removed ${email}` : "Removed a subuser";
    case "user.invite":
      return email ? `Resent invite to ${email}` : "Resent a subuser invite";
    case "settings.rename":
      return name ? `Renamed the server to ${name}` : "Updated the server name";
    case "settings.reinstall":
      return "Reinstalled the server";
    case "settings.update":
      return "Updated server settings";
    case "startup.update":
      return "Changed startup variables";
    case "database.create":
      return name ? `Created database ${name}` : "Created a database";
    case "database.rotate":
      return name ? `Rotated the password for ${name}` : "Rotated a database password";
    case "database.delete":
      return name ? `Deleted database ${name}` : "Deleted a database";
    case "schedule.create":
      return name ? `Created schedule ${name}` : "Created a schedule";
    case "schedule.update":
      return name ? `Updated schedule ${name}` : "Updated a schedule";
    case "schedule.delete":
      return name ? `Deleted schedule ${name}` : "Deleted a schedule";
    case "schedule.run":
      return name ? `Ran schedule ${name}` : "Ran a schedule";
    case "sftp.login":
      return "Connected over SFTP";
    case "allocation.primary":
      return name ? `Set ${name} as the primary address` : "Changed the primary address";
    case "allocation.update":
      return name ? `Updated ${name}` : "Updated an allocation";
    default:
      return event.replace(/[._]/g, " ");
  }
}
