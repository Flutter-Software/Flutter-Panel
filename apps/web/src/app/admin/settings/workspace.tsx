import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { AdminError } from "@/components/admin-table";
import { Card } from "@/components/ui";

export const SETTINGS_SECTIONS = ["branding", "updates", "mail", "sso"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export type SettingsNavItem = {
  id: SettingsSection;
  kicker: string;
  title: string;
  hint: string;
  icon: ReactNode;
  media?: ReactNode;
  tone?: "ok" | "warn" | "off" | "info";
};

const TONE = {
  ok: "bg-status-running",
  warn: "bg-status-warn",
  off: "bg-muted-foreground/50",
  info: "bg-primary",
} as const;

export function parseSettingsSection(value: string | null | undefined): SettingsSection | null {
  if (value && (SETTINGS_SECTIONS as readonly string[]).includes(value)) return value as SettingsSection;
  return null;
}

export function SettingsWorkspace({
  section,
  onSection,
  items,
  title,
  description,
  icon,
  error,
  children,
}: {
  section: SettingsSection;
  onSection: (id: SettingsSection) => void;
  items: SettingsNavItem[];
  title: string;
  description: string;
  icon: ReactNode;
  error: string | null;
  children: ReactNode;
}) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[17.5rem_minmax(0,1fr)] lg:gap-6">
      <nav
        aria-label="Settings sections"
        className="grid grid-cols-2 gap-2 lg:sticky lg:top-0 lg:grid-cols-1 lg:gap-1.5"
      >
        {items.map((item) => {
          const active = item.id === section;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSection(item.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-[4.5rem] items-start gap-3 overflow-hidden rounded-xl border px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
                active
                  ? "border-primary/45 bg-card shadow-[inset_3px_0_0_0_var(--primary)]"
                  : "border-border bg-background/60 hover:border-border hover:bg-card",
              )}
            >
              {item.media ? (
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
                  {item.media}
                </span>
              ) : (
                <span
                  className={cn(
                    "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
                    active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {item.icon}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    {item.kicker}
                  </span>
                  <span className={cn("size-1.5 rounded-full", TONE[item.tone ?? "off"])} />
                </span>
                <span className="mt-0.5 block truncate text-sm font-semibold">{item.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.hint}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <Card className="overflow-hidden">
        <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            {icon}
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        {error ? (
          <div className="px-5 pt-5 sm:px-6">
            <AdminError message={error} />
          </div>
        ) : null}
        <div className="space-y-4 px-5 py-5 sm:px-6">{children}</div>
      </Card>
    </div>
  );
}

export function SettingsActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-5 mt-2 flex flex-wrap items-end gap-3 border-t border-border bg-card/95 px-5 py-4 backdrop-blur-sm sm:-mx-6 sm:px-6">
      {children}
    </div>
  );
}
