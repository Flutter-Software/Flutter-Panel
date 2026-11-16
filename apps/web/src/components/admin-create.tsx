import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { cn } from "@/lib/cn";

export function AdminCreateHeader({
  backHref,
  backLabel,
  crumbs,
  title,
  description,
  actions,
}: {
  backHref: string;
  backLabel: string;
  crumbs: { href?: string; label: string }[];
  /** Accepted for existing callers but not drawn: page headers are type only (DESIGN.md). */
  icon?: ReactNode;
  title: string;
  description?: string;
  /** Buttons shown to the right of the title, e.g. "Download". */
  actions?: ReactNode;
}) {
  return (
    <div>
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {backLabel}
      </Link>
      <p className="mt-3 text-[13px] text-muted-foreground">
        {crumbs.map((crumb, index) => (
          <span key={`${crumb.label}-${index}`}>
            {index > 0 ? " / " : null}
            {crumb.href ? (
              <Link href={crumb.href} className="hover:text-foreground">
                {crumb.label}
              </Link>
            ) : (
              <span className="text-foreground">{crumb.label}</span>
            )}
          </span>
        ))}
      </p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[31px] font-semibold">{title}</h1>
          {description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function AdminSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    // A form panel: the heading and its one-line purpose, then the fields. No icon tile.
    <Card className="p-5 sm:p-6">
      <div className="mb-5 flex items-start gap-2.5">
        <span className="mt-[3px] shrink-0 text-muted-foreground [&_svg]:size-4" aria-hidden>
          {icon}
        </span>
        <div>
          <h2 className="text-[20px] font-semibold">{title}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
}) {
  return (
    <div
      role="group"
      className="grid rounded-md border border-input bg-well p-0.5"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-8 items-center justify-center gap-2 rounded-sm text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            value === option.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "no-press relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50",
        checked ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 flex size-5 items-center justify-center rounded-full bg-card transition-transform",
          checked && "translate-x-5",
        )}
      >
        {checked ? <Check className="size-3 text-primary" strokeWidth={3} /> : null}
      </span>
    </button>
  );
}

export function isDirty(current: unknown, baseline: unknown) {
  return JSON.stringify(current) !== JSON.stringify(baseline);
}

export function SaveIsland({
  summary,
  onCancel,
  submitLabel,
  pending,
  pendingLabel,
  disabled,
  visible = false,
}: {
  summary: ReactNode;
  onCancel: () => void;
  submitLabel: string;
  pending?: boolean;
  pendingLabel?: string;
  disabled?: boolean;
  visible?: boolean;
}) {
  if (!visible) return null;
  return (
    <>
      <div className="h-24 shrink-0" aria-hidden />
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center px-4 md:left-20">
        {/* A floating layer, so it gets the one float shadow and the 6px floating radius (DESIGN.md). */}
        <div className="pointer-events-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2.5 shadow-[var(--shadow-float)] transition-opacity duration-200 starting:opacity-0 sm:w-auto">
          <div className="min-w-0 text-sm text-muted-foreground">{summary}</div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || disabled}>
              {pending ? pendingLabel ?? "Creating…" : submitLabel}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
