"use client";

/**
 * Layout primitives for Admin → Settings.
 *
 * Modelled on the settings screens of Pterodactyl, Pelican and most hosting
 * control panels: a single row of tabs, then cards made of label/field rows.
 *
 *   General   Authentication   Email   Updates   Telemetry
 *   ───────────────────────────────────────────────────────
 *   Email                                        ● Active
 *   How the panel sends invites and password resets.
 *   ┌─ SettingsCard ─────────────────────────────────────┐
 *   │ Connection                                         │
 *   ├────────────────────┬───────────────────────────────┤
 *   │ Host               │ [ smtp.example.com ] [ 587 ]  │  ← SettingsRow
 *   │ Your mail server.  │                               │
 *   ├────────────────────┴───────────────────────────────┤
 *   │ footer (hints, env notes)                          │
 *   └────────────────────────────────────────────────────┘
 *              [ Unsaved changes   Discard   Save ]
 *
 * - Rows put the explanation on the left and the control on the right, so
 *   every setting reads the same way. On phones they stack.
 * - No always-visible Save button: a floating bar appears once something
 *   changes, with Discard and Save (and Ctrl/⌘+S). Saving submits the
 *   section's <form> by id, so each section keeps its own submit handler.
 */

import { useEffect, type ReactNode } from "react";
import { Button } from "@mantine/core";
import { cn } from "@/lib/cn";
import { AdminError } from "@/components/admin-table";
import { Card } from "@/components/ui";
import { pressedKey } from "@/components/kbd";

export const SETTINGS_SECTIONS = ["branding", "sso", "mail", "updates", "telemetry"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export type SettingsTone = "ok" | "warn" | "off" | "info";

export type SettingsTab = {
  id: SettingsSection;
  label: string;
  icon: ReactNode;
  /** Health of the section; drives the header badge and a small dot on the tab. */
  tone?: SettingsTone;
  /** Short status text shown in the section header badge. */
  status?: string;
};

const DOT: Record<SettingsTone, string> = {
  ok: "bg-status-running",
  warn: "bg-status-warn",
  off: "bg-muted-foreground/40",
  info: "bg-status-info",
};

/** Status word colour; paired with the LED dot (DESIGN.md: status is an LED plus its word, no pill). */
const STATUS_TEXT: Record<SettingsTone, string> = {
  ok: "text-status-running",
  warn: "text-status-warn",
  off: "text-muted-foreground",
  info: "text-status-info",
};

export function parseSettingsSection(value: string | null | undefined): SettingsSection | null {
  if (value && (SETTINGS_SECTIONS as readonly string[]).includes(value)) return value as SettingsSection;
  return null;
}

/** Tab bar + section header + content. */
export function SettingsWorkspace({
  section,
  onSection,
  tabs,
  title,
  description,
  error,
  dirtySections,
  children,
}: {
  section: SettingsSection;
  onSection: (id: SettingsSection) => void;
  tabs: SettingsTab[];
  title: string;
  description: string;
  error: string | null;
  /** Sections with unsaved edits get a dot on their tab. */
  dirtySections?: ReadonlySet<SettingsSection>;
  children: ReactNode;
}) {
  const active = tabs.find((tab) => tab.id === section);

  return (
    <div className="space-y-6">
      <nav aria-label="Settings sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div role="tablist" className="flex min-w-max gap-1 border-b border-border">
          {tabs.map((tab) => {
            const current = tab.id === section;
            const dirty = dirtySections?.has(tab.id);
            // Only surface a dot when it means something: unsaved edits, or a warning.
            const dot = dirty ? "bg-primary" : tab.tone === "warn" ? DOT.warn : null;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={current}
                onClick={() => onSection(tab.id)}
                className={cn(
                  "group relative -mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap outline-none transition-colors focus-visible:bg-muted/50 focus-visible:text-foreground",
                  current
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 items-center justify-center [&>svg]:size-4",
                    current ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                  )}
                >
                  {tab.icon}
                </span>
                {tab.label}
                {dot ? (
                  <span
                    className={cn("size-1.5 rounded-full", dot)}
                    title={dirty ? "Unsaved changes" : tab.status}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      <section aria-labelledby="settings-pane-title" className="min-w-0 space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 id="settings-pane-title" className="text-[20px] font-semibold">
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
    <span className={cn("inline-flex shrink-0 items-center gap-2 pt-1 text-[13px] font-medium", STATUS_TEXT[tone])}>
      <span aria-hidden className={cn("size-2 rounded-full", DOT[tone])} />
      {children}
    </span>
  );
}

/**
 * A card of settings. Children are normally `SettingsRow` / `SettingsToggleRow`,
 * which pad themselves and are separated by hairlines.
 */
export function SettingsCard({
  title,
  description,
  aside,
  footer,
  className,
  children,
}: {
  title?: string;
  description?: ReactNode;
  /** Right side of the header (a button, a badge…). */
  aside?: ReactNode;
  /** Muted strip under the rows for hints and notes. */
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      {title ? (
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold">{title}</h3>
            {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {aside ? <div className="shrink-0">{aside}</div> : null}
        </div>
      ) : null}
      {children ? <div className="divide-y divide-border">{children}</div> : null}
      {footer ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-border bg-well/60 px-5 py-3 text-[13px] text-muted-foreground sm:px-6">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * One setting: label and help text on the left, the control on the right.
 * Pass `htmlFor` with the control's `id` so clicking the label focuses it.
 */
export function SettingsRow({
  label,
  description,
  htmlFor,
  required = false,
  children,
}: {
  label: string;
  description?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-x-8 gap-y-2.5 px-5 py-5 sm:px-6 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
          {required ? <span className="ml-0.5 text-status-error">*</span> : null}
        </label>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="min-w-0 space-y-2 md:pt-0.5">{children}</div>
    </div>
  );
}

/** A labelled on/off row: text on the left, a switch on the right. */
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
    <div className="flex items-start justify-between gap-6 px-5 py-5 sm:px-6">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="mt-0.5 max-w-xl text-sm text-muted-foreground">{description}</p> : null}
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
      className="inline-flex w-full rounded-md border border-input bg-well p-0.5 sm:w-auto"
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
              "flex-1 rounded-sm px-3 py-1.5 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 sm:flex-none",
              active ? "bg-card font-medium text-foreground ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Read-only value with a copy button (redirect URIs, install IDs…). */
export function CopyField({
  value,
  copied,
  onCopy,
  label,
}: {
  value: string;
  copied: boolean;
  onCopy: () => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-input bg-well px-3 py-2 font-mono text-[12.5px]">
        {value || "Not available yet"}
      </code>
      <Button type="button" variant="default" disabled={!value} onClick={onCopy} aria-label={label}>
        {copied ? "Copied" : "Copy"}
      </Button>
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
      if ((event.ctrlKey || event.metaKey) && pressedKey(event) === "s") {
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
        // Floating layer: the one place on this page allowed the float shadow and 6px corners (DESIGN.md).
        className="flutter-toast-in pointer-events-auto flex w-full max-w-xl items-center gap-3 rounded-xl border border-border bg-card py-2 pr-2 pl-4 shadow-[var(--shadow-float)]"
      >
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-status-warn" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">Unsaved changes</p>
        <kbd className="hidden rounded-md border border-border bg-well px-1.5 py-0.5 text-[12px] text-muted-foreground sm:inline">
          Ctrl+S
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
