import { z } from "zod";
import { objectIdSchema } from "./schemas";

export const API_KEY_CLIENT_PREFIX = "flc_";
export const API_KEY_APPLICATION_PREFIX = "fla_";
export const API_KEY_MAX_PER_USER = 25;

export const API_KEY_KINDS = ["client", "application"] as const;
export type ApiKeyKind = (typeof API_KEY_KINDS)[number];

export const APPLICATION_SCOPES = [
  "users.read",
  "users.write",
  "servers.read",
  "servers.write",
  "nodes.read",
  "nodes.write",
  "locations.read",
  "locations.write",
  "nests.read",
  "nests.write",
  "database-hosts.read",
  "database-hosts.write",
  "settings.read",
  "settings.write",
] as const;

export type ApplicationScope = (typeof APPLICATION_SCOPES)[number];

export const APPLICATION_SCOPE_GROUPS: { key: string; label: string; read: ApplicationScope; write: ApplicationScope }[] = [
  { key: "users", label: "Users", read: "users.read", write: "users.write" },
  { key: "servers", label: "Servers", read: "servers.read", write: "servers.write" },
  { key: "nodes", label: "Nodes", read: "nodes.read", write: "nodes.write" },
  { key: "locations", label: "Locations", read: "locations.read", write: "locations.write" },
  { key: "nests", label: "Nests & eggs", read: "nests.read", write: "nests.write" },
  { key: "database-hosts", label: "Database hosts", read: "database-hosts.read", write: "database-hosts.write" },
  { key: "settings", label: "Settings", read: "settings.read", write: "settings.write" },
];

export const apiKeyKindSchema = z.enum(API_KEY_KINDS);

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(64),
  kind: apiKeyKindSchema.default("client"),
  serverIds: z.array(objectIdSchema).max(50).optional(),
  scopes: z.array(z.string().max(40)).max(40).optional(),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
});

export type ApiKeyCreate = z.infer<typeof apiKeyCreateSchema>;

export function isApplicationScope(value: string): value is ApplicationScope {
  return (APPLICATION_SCOPES as readonly string[]).includes(value);
}

export function applicationScopeForPath(path: string, write: boolean): ApplicationScope | null {
  const need = (read: ApplicationScope, writeScope: ApplicationScope) => (write ? writeScope : read);
  if (path.includes("/admin/users")) return need("users.read", "users.write");
  if (path.includes("/admin/servers")) return need("servers.read", "servers.write");
  if (path.includes("/admin/nodes")) return need("nodes.read", "nodes.write");
  if (path.includes("/admin/locations")) return need("locations.read", "locations.write");
  if (path.includes("/admin/nests") || path.includes("/admin/eggs")) return need("nests.read", "nests.write");
  if (path.includes("/admin/database-hosts")) return need("database-hosts.read", "database-hosts.write");
  if (path.includes("/admin/settings")) return need("settings.read", "settings.write");
  return null;
}
