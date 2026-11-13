"use client";

/**
 * Layout primitives for Admin → Settings.
 *
 * The page follows the common settings pattern used by Vercel, Linear,
 * GitHub and Stripe:
 *
 *   ┌────────────┬──────────────────────────────────────────────┐
 *   │ GENERAL    │ Mail                              ● Active   │
 *   │  Branding  │ How the panel sends invites and resets.      │
 *   │ SYSTEM     │ ┌─ SettingsCard ───────────────────────────┐ │
 *   │  Updates • │ │ title / description / fields             │ │
 *   │  Telemetry │ ├──────────────────────────────────────────┤ │
 *   │ AUTH       │ │ footer (secondary actions)               │ │
 *   │  Mail      │ └──────────────────────────────────────────┘ │
 *   │  Sign-in   │          ╭ Unsaved changes  Discard  Save ╮  │
 *   └────────────┴──────────────────────────────────────────────┘
 *
 * - A compact, grouped nav (horizontal scrolling tabs on mobile).
 * - Content split into focused cards instead of one long form.
 * - No always-visible Save button: a floating bar appears once something
 *   changes, with Discard and Save (and Ctrl/⌘+S). Saving submits the
 *   section's <form> by id, so each section keeps its own submit handler.
 */

import { useEffect, type ReactNode } from "react";
import { Button } from "@mantine/core";
import { cn } from "@/lib/cn";
import { AdminError } from "@/components/admin-table";
import { Card } from "@/components/ui";

export const SETTINGS_SECTIONS = ["branding", "updates", "mail", "sso", "telemetry"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export type SettingsTone = "ok" | "warn" | "off" | "info";

export type SettingsNavItem = {
  id: SettingsSection;
  label: string;
  icon: ReactNode;
  /** Small status dot at the end of the row. */
  tone?: SettingsTone;
  /** Short status text shown in the content header badge. */
  status?: string;
};

export type SettingsNavGroup = { label: string; items: SettingsNavItem[] };

const DOT: Record<SettingsTone, string> = {
  ok: "bg-status-running",
  warn: "bg-status-warn",
  off: "bg-muted-foreground/40",
  info: "bg-status-info",
};

const BADGE: Record<SettingsTone, string> = {
  ok: "bg-status-running/12 text-status-running ring-status-running/25",
  warn: "bg-status-warn/12 text-status-warn ring-status-warn/25",
  off: "bg-muted text-muted-foreground ring-border",
  info: "bg-status-info/12 text-status-info ring-status-info/25",
};

export function parseSettingsSection(value: string | null | undefined): SettingsSection | null {
  if (value && (SETTINGS_SECTIONS as readonly string[]).includes(value)) return value as SettingsSection;
  return null;
}

export function SettingsWorkspace({
  section,
  onSection,
  groups,
  title,
  description,
  error,
  dirtySections,
  children,
}: {
  section: SettingsSection;
  onSection: (id: SettingsSection) => void;
  groups: SettingsNavGroup[];
  title: string;
  description: string;
  error: string | null;
  /** Sections with unsaved edits get a dot in the nav. */
  dirtySections?: ReadonlySet<SettingsSection>;
  children: ReactNode;
}) {
  const active = groups.flatMap((group) => group.items).find((item) => item.id === section);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-10">
      <nav aria-label="Settings sections" className="lg:sticky lg:top-0">
        {/* Mobile: one horizontally scrolling row of tabs. Desktop: grouped vertical list. */}
        <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0">
          {groups.map((group) => (
            <div key={group.label} className="flex shrink-0 gap-1 lg:flex-col lg:gap-0.5">
              <p className="hidden px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase lg:block">
                {group.label}
              </p>
              {group.items.map((item) => {
                const current = item.id === section;
                const dirty = dirtySections?.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSection(item.id)}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "group flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
                      current
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center transition-colors [&>svg]:size-4",
                        current ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                      )}
                    >
                      {item.icon}
                    </span>
                    <span className="flex-1 text-left">{item.label}</span>
                    {dirty ? (
                      <span className="size-1.5 shrink-0 rounded-full bg-primary" title="Unsaved changes" />
                    ) : item.tone && item.tone !== "off" ? (
                      <span className={cn("size-1.5 shrink-0 rounded-full", DOT[item.tone])} />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </nav>

      <section aria-labelledby="settings-pane-title" className="min-w-0 space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 id="settings-pane-title" className="text-lg font-semibold tracking-tight">
              {title}
            </h2>
            <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
          </div>
          {active?.status ? <StatusBadge tone={active.tone ?? "off"}>{active.status}</StatusBadge> : null}
        </header>
        <AdminError message={error} />
        {children}
      </section>
    </div>
  );
}

export function StatusBadge({ tone, children }: { tone: SettingsTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        BADGE[tone],
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT[tone])} />
      {children}
    </span>
  );
}

/** One focused group of settings: header, body, optional footer strip. */
export function SettingsCard({
  title,
  description,
  aside,
  footer,
  className,
  bodyClassName,
  children,
}: {
  title?: string;
  description?: ReactNode;
  /** Right side of the header (a switch, a badge…). */
  aside?: ReactNode;
  /** Muted strip under the body for hints and secondary actions. */
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      {title ? (
        <div className={cn("flex items-start justify-between gap-4 px-5 pt-5 sm:px-6", !children && "pb-5")}>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{title}</h3>
            {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {aside ? <div className="shrink-0">{aside}</div> : null}
        </div>
      ) : null}
      {children ? <div className={cn("space-y-4 px-5 py-5 sm:px-6", bodyClassName)}>{children}</div> : null}
      {footer ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-border bg-muted/25 px-5 py-3 text-sm text-muted-foreground sm:px-6">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}

/** A labelled on/off row: text on the left, control on the right. */
export function SettingsToggleRow({
  title,
  description,
  control,
}: {
  title: string;
  description?: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  );
}

/** Compact segmented picker (radio group) for 2–4 mutually exclusive options. */
export function SettingsSegmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex w-full rounded-lg border border-border bg-background p-0.5 sm:w-auto"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 sm:flex-none",
              active ? "bg-muted font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Floating "unsaved changes" bar. Save submits the form with `formId`, so the
 * section's own onSubmit (validation, API call, toast) runs unchanged.
 * Ctrl/⌘+S triggers the same submit while the bar is showing.
 */
export function UnsavedChangesBar({
  visible,
  formId,
  saving,
  onDiscard,
  saveLabel = "Save changes",
}: {
  visible: boolean;
  formId: string;
  saving: boolean;
  onDiscard: () => void;
  saveLabel?: string;
}) {
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        const form = document.getElementById(formId);
        if (form instanceof HTMLFormElement) form.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, formId]);

  if (!visible) return null;
  return (
    <div className="pointer-events-none sticky bottom-4 z-20 flex justify-center pt-2">
      <div
        role="region"
        aria-label="Unsaved changes"
        className="flutter-toast-in pointer-events-auto flex w-full max-w-xl items-center gap-3 rounded-xl border border-border bg-card/95 py-2 pr-2 pl-4 shadow-xl shadow-black/25 backdrop-blur-md"
      >
        <span className="size-2 shrink-0 rounded-full bg-status-warn" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">You have unsaved changes</p>
        <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
          Ctrl S
        </kbd>
        <Button type="button" variant="subtle" color="gray" disabled={saving} onClick={onDiscard}>
          Discard
        </Button>
        <Button type="submit" form={formId} loading={saving}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
