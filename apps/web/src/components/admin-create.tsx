import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { cn } from "@/lib/cn";

export function AdminCreateHeader({
  backHref,
  backLabel,
  crumbs,
  icon,
  title,
  description,
}: {
  backHref: string;
  backLabel: string;
  crumbs: { href?: string; label: string }[];
  icon: ReactNode;
  title: string;
  description: string;
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
      <p className="mt-3 text-xs text-muted-foreground">
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
      <div className="mt-3 flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
          {icon}
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
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
    <Card className="p-5 sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </div>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
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
      className="grid rounded-lg border border-input bg-input/40 p-0.5"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors",
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
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "no-press relative h-6 w-11 shrink-0 rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 block size-5 rounded-full bg-card transition-transform",
          checked && "translate-x-5",
        )}
      />
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
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center px-4 md:left-20">
      <div className="pointer-events-auto flex w-full max-w-6xl flex-col gap-3 rounded-2xl border border-border/60 bg-background/40 px-5 py-3 shadow-lg ring-1 ring-white/10 backdrop-blur-xl transition duration-200 starting:translate-y-3 starting:opacity-0 sm:w-fit sm:min-w-[36rem] sm:flex-row sm:items-center sm:justify-between sm:gap-8">
        <div className="text-sm text-muted-foreground">{summary}</div>
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
  );
}
