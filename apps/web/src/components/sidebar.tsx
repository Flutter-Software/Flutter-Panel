"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Box,
  Clock,
  Cpu,
  Database,
  Folder,
  LayoutDashboard,
  MapPin,
  Network,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  Terminal,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { prefetchQuery } from "@/lib/query";
import { useAuth } from "@/components/auth-provider";
import { can, canOpenSettings } from "@/lib/access";
import { NAV_PERMISSION } from "@flutter-software/shared";
import type { ServerRecord } from "@/lib/types";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const SERVER_NAV: NavItem[] = [
  { href: "console", label: "Console", icon: Terminal },
  { href: "files", label: "Files", icon: Folder },
  { href: "databases", label: "Databases", icon: Database },
  { href: "schedules", label: "Schedules", icon: Clock },
  { href: "users", label: "Users", icon: Users },
  { href: "backups", label: "Backups", icon: Archive },
  { href: "network", label: "Network", icon: Network },
  { href: "startup", label: "Startup", icon: SlidersHorizontal },
  { href: "settings", label: "Settings", icon: Settings },
];

export const ADMIN_NAV = [
  {
    group: "Server",
    items: [
      { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
      { href: "/admin/servers", label: "Servers", icon: Server },
      { href: "/admin/nodes", label: "Nodes", icon: Cpu },
      { href: "/admin/locations", label: "Locations", icon: MapPin },
      { href: "/admin/nests", label: "Nests", icon: Box },
    ],
  },
  {
    group: "User",
    items: [{ href: "/admin/users", label: "Users", icon: Users }],
  },
  {
    group: "Management",
    items: [{ href: "/admin/settings", label: "Settings", icon: Settings }],
  },
];

const ADMIN_PREFETCH: Record<string, string[]> = {
  "/admin": [
    "/api/v1/admin/servers",
    "/api/v1/admin/users",
    "/api/v1/admin/locations",
    "/api/v1/admin/nodes",
    "/api/v1/health",
  ],
  "/admin/servers": ["/api/v1/admin/servers"],
  "/admin/nodes": ["/api/v1/admin/nodes"],
  "/admin/locations": ["/api/v1/admin/locations"],
  "/admin/nests": ["/api/v1/admin/nests"],
  "/admin/users": ["/api/v1/admin/users"],
  "/admin/settings": ["/api/v1/admin/settings"],
};

function prefetchAdmin(href: string) {
  for (const path of ADMIN_PREFETCH[href] ?? []) prefetchQuery(path);
}

function prefetchServer(href: string, serverId: string) {
  prefetchQuery(`/api/v1/client/servers/${serverId}`);
  if (href.endsWith("/network")) {
    prefetchQuery(`/api/v1/client/servers/${serverId}/network`);
  }
  if (href.endsWith("/console")) {
    prefetchQuery(`/api/v1/client/servers/${serverId}/console/socket`);
  }
  if (href.endsWith("/users")) {
    prefetchQuery(`/api/v1/client/servers/${serverId}/users`);
  }
}

export function SidebarNav({
  items,
  match,
  onPrefetch,
}: {
  items: NavItem[];
  match: (href: string) => boolean;
  onPrefetch?: (href: string) => void;
}) {
  return (
    <nav className="flex flex-col gap-0.5 p-3">
      {items.map((item) => {
        const Icon = item.icon;
        const active = match(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onMouseEnter={() => onPrefetch?.(item.href)}
            onFocus={() => onPrefetch?.(item.href)}
            className={cn(
              "relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-accent font-medium text-primary before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary"
                : "text-sidebar-foreground/80 hover:bg-accent/70 hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-60 shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar md:block">
      {ADMIN_NAV.map((group) => (
        <div key={group.group} className="px-3 pt-4">
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {group.group}
          </p>
          <SidebarNav
            items={group.items}
            onPrefetch={prefetchAdmin}
            match={(href) =>
              href === "/admin" ? pathname === "/admin" : pathname.startsWith(href)
            }
          />
        </div>
      ))}
    </aside>
  );
}

export function ServerSidebar({
  serverId,
  server,
}: {
  serverId: string;
  server: ServerRecord | null;
}) {
  const pathname = usePathname();
  const { user } = useAuth();
  const items = SERVER_NAV.filter((item) => {
    if (!server) return true;
    if (item.href === "settings") return canOpenSettings(server);
    const perm = NAV_PERMISSION[item.href];
    return perm ? can(server, perm) : true;
  }).map((item) => ({
    ...item,
    href: `/server/${serverId}/${item.href}`,
  }));

  return (
    <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-60 shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar md:flex md:flex-col">
      <SidebarNav
        items={items}
        match={(href) => pathname === href}
        onPrefetch={(href) => prefetchServer(href, serverId)}
      />
      {user?.role === "admin" ? (
        <div className="mt-auto border-t border-sidebar-border p-3">
          <Link
            href="/admin"
            onMouseEnter={() => prefetchQuery("/api/v1/admin/servers")}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-accent/70 hover:text-foreground"
          >
            <Shield className="size-4 shrink-0" />
            Admin
          </Link>
        </div>
      ) : null}
    </aside>
  );
}
