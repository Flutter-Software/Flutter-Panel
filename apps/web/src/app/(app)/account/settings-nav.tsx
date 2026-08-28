"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Laptop, Monitor, Shield, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";

const ITEMS = [
  { href: "/account", label: "Profile", icon: UserRound },
  { href: "/account/appearance", label: "Appearance", icon: Monitor },
  { href: "/account/security", label: "Security", icon: Shield },
  { href: "/account/sessions", label: "Sessions", icon: Laptop },
] as const;

export function AccountSettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto lg:w-52 lg:shrink-0 lg:flex-col lg:overflow-visible">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        // /account is a prefix of every other settings route, so Profile has to
        // be an exact match or it stays highlighted on Security/Sessions/etc.
        const active =
          item.href === "/account" ? pathname === "/account" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "inline-flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap",
              active
                ? "bg-muted font-medium text-primary"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Icon className={cn("size-4 shrink-0", active && "text-primary")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 flex-1">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-6 space-y-4">{children}</div>
    </div>
  );
}
