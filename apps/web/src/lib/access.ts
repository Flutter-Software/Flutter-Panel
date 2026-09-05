import {
  hasServerPermission,
  NAV_PERMISSION,
  type ServerPermission,
} from "@flutter-software/shared";
import type { ServerRecord } from "@/lib/types";

export function can(server: ServerRecord | null | undefined, permission: ServerPermission) {
  if (!server) return false;
  if (server.owner) return true;
  return hasServerPermission(server.permissions, permission);
}

export function canOpenSettings(server: ServerRecord | null | undefined) {
  // Settings nav is a combined page. Show it if they can rename or reinstall.
  return can(server, "settings.rename") || can(server, "settings.reinstall");
}

export function serverHomeHref(server: ServerRecord) {
  const order = [
    "console",
    "files",
    "backups",
    "network",
    "startup",
    "users",
    "settings",
    "databases",
    "schedules",
    "activity",
  ] as const;
  for (const key of order) {
    if (key === "settings") {
      if (canOpenSettings(server)) return `/server/${server.id}/settings`;
      continue;
    }
    if (key === "databases" && !(server.databaseLimit && server.databaseLimit > 0)) continue;
    if (key === "backups" && server.backupsEnabled === false) continue;
    const perm = NAV_PERMISSION[key];
    if (perm && can(server, perm)) return `/server/${server.id}/${key}`;
  }
  return `/server/${server.id}/console`;
}
