"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

export function buttonClass({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(
    "pressable inline-flex items-center justify-center gap-2 rounded-lg font-medium disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none",
    size === "sm" ? "h-8 px-2.5 text-xs" : "h-10 px-3.5 text-sm",
    variant === "primary" &&
      "bg-primary text-primary-foreground shadow-sm hover:bg-primary/80 hover:shadow-md hover:shadow-primary/25 active:bg-primary/70",
    variant === "secondary" &&
      "bg-secondary text-secondary-foreground hover:bg-muted hover:shadow-sm active:bg-muted/80",
    variant === "ghost" && "text-foreground hover:bg-muted active:bg-accent",
    variant === "danger" &&
      "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/80 hover:shadow-md hover:shadow-destructive/25 active:bg-destructive/70",
    className,
  );
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <button className={buttonClass({ variant, size, className })} {...props} />;
}

export function ButtonLink({
  href,
  className,
  variant = "primary",
  size = "md",
  children,
}: {
  href: string;
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass({ variant, size, className })}>
      {children}
    </Link>
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg border border-input bg-input/60 px-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/30",
        className,
      )}
      {...props}
    />
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card text-card-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  required,
  extra,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  extra?: ReactNode;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between text-sm">
        <span>
          {label}
          {required ? <span className="ml-0.5 text-destructive">*</span> : null}
        </span>
        {extra}
      </span>
      {children}
      {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-[88px] w-full resize-y rounded-lg border border-input bg-input/60 px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/30",
        className,
      )}
      {...props}
    />
  );
}

export function selectClass(className?: string) {
  return cn(
    "h-10 w-full rounded-lg border border-input bg-input/60 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30",
    className,
  );
}

export { SearchSelect, Select } from "./select";
export type { SelectOption } from "./select";

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <Card className="px-6 py-16 text-center">
      <p className="text-base font-semibold">{title}</p>
      {description ? (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      ) : null}
    </Card>
  );
}

export function Modal({
  title,
  description,
  open,
  onClose,
  children,
  footer,
  className,
}: {
  title: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        className="no-press absolute inset-0 bg-background/80 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="flutter-modal-title"
        className={cn(
          "relative flex max-h-[min(92vh,52rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl",
          className,
        )}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="flutter-modal-title" className="text-base font-semibold">
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <Button type="button" size="sm" variant="ghost" className="size-8 px-0" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
