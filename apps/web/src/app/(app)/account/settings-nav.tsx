"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";

const ITEMS = [
  { href: "/account", label: "Profile" },
  { href: "/account/appearance", label: "Appearance" },
  { href: "/account/security", label: "Security" },
  { href: "/account/sessions", label: "Sessions" },
  { href: "/account/api-keys", label: "API keys" },
] as const;

/**
 * Settings navigation. Wide screens: a vertical list where the active page gets
 * the 2px signal-cyan rule on its left (the `inset` treatment). Narrow screens:
 * underline tabs on a seam, the same pattern as the server list tabs.
 */
export function AccountSettingsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Account settings"
      className="-mx-4 flex gap-5 overflow-x-auto border-b border-border px-4 lg:mx-0 lg:w-48 lg:shrink-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:border-b-0 lg:px-0"
    >
      {ITEMS.map((item) => {
        // /account is a prefix of every other settings route, so Profile has to
        // be an exact match or it stays highlighted on Security/Sessions/etc.
        const active =
          item.href === "/account" ? pathname === "/account" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 pb-2 text-sm outline-none focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              "lg:mb-0 lg:border-b-0 lg:border-l-2 lg:py-1.5 lg:pb-1.5 lg:pl-3",
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground lg:hover:border-border",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** One settings page: its title, one sentence about it, then its panels. Forms cap at 72ch. */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 max-w-[72ch] flex-1">
      <h2 className="text-[25px] font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-6 space-y-8">{children}</div>
    </div>
  );
}

/**
 * A settings form: one panel whose rows are separated by seams (DESIGN.md →
 * Panel). Put `SettingsRow`s and, last, a `SettingsFooter` inside.
 */
export function SettingsPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={cn("divide-y divide-border", className)}>{children}</Card>;
}

/**
 * One row of a settings panel: what the setting is on the left, its control on
 * the right. Stacks on narrow screens.
 */
export function SettingsRow({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] md:gap-6",
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="font-sans text-sm font-medium">{title}</h3>
        {description ? <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="min-w-0">{children}</div> : null}
    </div>
  );
}

/** Bottom row of a settings panel: the save result on the left, the action on the right. */
export function SettingsFooter({ children, message }: { children: ReactNode; message?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
      {message ? <div className="mr-auto min-w-0">{message}</div> : null}
      {children}
    </div>
  );
}

/** Result line for a settings form: green when it worked, red with the reason when it didn't. */
export function SettingsMessage({ error, success }: { error?: string | null; success?: string | null }) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-status-error">
        {error}
      </p>
    );
  }
  if (success) {
    return (
      <p role="status" className="text-sm text-status-running">
        {success}
      </p>
    );
  }
  return null;
}
