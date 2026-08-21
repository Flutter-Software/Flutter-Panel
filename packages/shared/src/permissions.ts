export const SERVER_PERMISSIONS = [
  "control.console",
  "control.start",
  "control.stop",
  "control.restart",
  "file.read",
  "file.write",
  "file.delete",
  "file.archive",
  "backup.read",
  "backup.create",
  "backup.delete",
  "backup.restore",
  "allocation.read",
  "startup.read",
  "startup.update",
  "settings.rename",
  "settings.reinstall",
  "user.read",
  "user.create",
  "user.update",
  "user.delete",
  "database.read",
  "schedule.read",
] as const;

export type ServerPermission = (typeof SERVER_PERMISSIONS)[number];

export const PERMISSION_GROUPS: {
  key: string;
  label: string;
  description: string;
  permissions: { key: ServerPermission; label: string; description: string }[];
}[] = [
  {
    key: "control",
    label: "Control",
    description: "Console output and power actions.",
    permissions: [
      { key: "control.console", label: "Console", description: "View the console and send commands." },
      { key: "control.start", label: "Start", description: "Start the server." },
      { key: "control.stop", label: "Stop", description: "Stop or kill the server." },
      { key: "control.restart", label: "Restart", description: "Restart the server." },
    ],
  },
  {
    key: "files",
    label: "Files",
    description: "Browse and change server files.",
    permissions: [
      { key: "file.read", label: "Read", description: "List directories and open files." },
      { key: "file.write", label: "Write", description: "Create, upload, rename, and save files." },
      { key: "file.delete", label: "Delete", description: "Delete files and folders." },
      { key: "file.archive", label: "Archive", description: "Extract zip and tar archives." },
    ],
  },
  {
    key: "backups",
    label: "Backups",
    description: "Snapshots of the server filesystem.",
    permissions: [
      { key: "backup.read", label: "Read", description: "List backups." },
      { key: "backup.create", label: "Create", description: "Create a new backup." },
      { key: "backup.delete", label: "Delete", description: "Delete backups." },
      { key: "backup.restore", label: "Restore", description: "Restore a backup onto the server." },
    ],
  },
  {
    key: "network",
    label: "Network",
    description: "Allocations assigned to this server.",
    permissions: [{ key: "allocation.read", label: "Read", description: "View allocations and the connection address." }],
  },
  {
    key: "startup",
    label: "Startup",
    description: "Egg startup command and environment.",
    permissions: [
      { key: "startup.read", label: "Read", description: "View startup and environment variables." },
      { key: "startup.update", label: "Update", description: "Change environment variables." },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    description: "Server identity and reinstall.",
    permissions: [
      { key: "settings.rename", label: "Rename", description: "Change the server name and description." },
      { key: "settings.reinstall", label: "Reinstall", description: "Run the egg install script again." },
    ],
  },
  {
    key: "users",
    label: "Users",
    description: "Subusers on this server.",
    permissions: [
      { key: "user.read", label: "Read", description: "View subusers and their permissions." },
      { key: "user.create", label: "Create", description: "Add subusers and send invites." },
      { key: "user.update", label: "Update", description: "Change subuser permissions." },
      { key: "user.delete", label: "Delete", description: "Remove subusers." },
    ],
  },
];

export const NAV_PERMISSION: Record<string, ServerPermission> = {
  console: "control.console",
  files: "file.read",
  databases: "database.read",
  schedules: "schedule.read",
  users: "user.read",
  backups: "backup.read",
  network: "allocation.read",
  startup: "startup.read",
  settings: "settings.rename",
};

export function isServerPermission(value: string): value is ServerPermission {
  return (SERVER_PERMISSIONS as readonly string[]).includes(value);
}

export function normalizePermissions(raw: unknown): ServerPermission[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<ServerPermission>();
  for (const item of raw) {
    if (typeof item === "string" && isServerPermission(item)) seen.add(item);
  }
  return SERVER_PERMISSIONS.filter((key) => seen.has(key));
}

export function hasServerPermission(granted: readonly string[] | undefined, need: ServerPermission) {
  if (!granted || granted.length === 0) return false;
  if (granted.includes("*")) return true;
  return granted.includes(need);
}
