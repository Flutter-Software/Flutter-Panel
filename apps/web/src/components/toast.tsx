"use client";

/**
 * Panel-wide toasts.
 *
 *   toast("Could not send command");          // error (default, for catch blocks)
 *   toast("Branding saved.", "success");
 *   toast("Daemon is restarting", "info");
 *   toast("Disk is almost full", "warning");
 *
 * Design notes:
 * - Each toast is a card with a tinted status icon, the message, a close
 *   button, and a thin countdown bar along the bottom edge.
 * - The countdown is a CSS animation; its `animationend` dismisses the toast.
 *   Hovering (or focusing) the stack pauses every bar via
 *   `animation-play-state`, so a toast never vanishes while being read.
 * - Repeating the same message while it is still visible bumps a "×N"
 *   counter and restarts its countdown instead of stacking duplicates
 *   (e.g. a power button mashed while the daemon is down).
 * - At most MAX_VISIBLE toasts are shown; older ones are dropped.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type ToastVariant = "error" | "success" | "info" | "warning";

type ToastItem = {
  id: number;
  message: string;
  variant: ToastVariant;
  /** How many times this exact message was raised while visible. */
  count: number;
  /** Bumped on repeat so the countdown bar remounts and restarts. */
  cycle: number;
  leaving?: boolean;
};

const SHOW_MS = 4500;
/** Errors usually carry something worth reading twice. */
const SHOW_ERROR_MS = 6500;
const MAX_VISIBLE = 4;

let pushToast: (message: string, variant: ToastVariant) => void = () => {};
let nextId = 1;

export function toast(message: string, variant: ToastVariant = "error") {
  pushToast(message, variant);
}

/**
 * Per-variant look. Colours come from the panel's status tokens
 * (globals.css), so toasts follow custom branding and both themes.
 */
const VARIANTS: Record<ToastVariant, { icon: LucideIcon; tint: string; bar: string; label: string }> = {
  error: {
    icon: CircleAlert,
    tint: "bg-status-error/15 text-status-error",
    bar: "bg-status-error",
    label: "Error",
  },
  success: {
    icon: CircleCheck,
    tint: "bg-status-running/15 text-status-running",
    bar: "bg-status-running",
    label: "Success",
  },
  info: {
    icon: Info,
    tint: "bg-status-info/15 text-status-info",
    bar: "bg-status-info",
    label: "Notice",
  },
  warning: {
    icon: TriangleAlert,
    tint: "bg-status-warn/15 text-status-warn",
    bar: "bg-status-warn",
    label: "Warning",
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((current) =>
      current.map((item) => (item.id === id && !item.leaving ? { ...item, leaving: true } : item)),
    );
  }, []);

  const push = useCallback((message: string, variant: ToastVariant) => {
    setItems((current) => {
      const repeat = current.find(
        (item) => !item.leaving && item.message === message && item.variant === variant,
      );
      if (repeat) {
        return current.map((item) =>
          item === repeat ? { ...item, count: item.count + 1, cycle: item.cycle + 1 } : item,
        );
      }
      const id = nextId;
      nextId += 1;
      const visible = current.filter((item) => !item.leaving).slice(-(MAX_VISIBLE - 1));
      return [...visible, { id, message, variant, count: 1, cycle: 0 }];
    });
  }, []);

  useEffect(() => {
    pushToast = push;
    return () => {
      pushToast = () => {};
    };
  }, [push]);

  return (
    <>
      {children}
      <div
        // Container stays mounted so screen readers keep the live region registered.
        aria-live="polite"
        className="flutter-toast-stack pointer-events-none fixed top-20 right-4 z-50 flex w-[min(100%-2rem,24rem)] flex-col gap-2"
      >
        {items.map((item) => (
          <Toast
            key={item.id}
            item={item}
            onDismiss={() => dismiss(item.id)}
            onGone={() => remove(item.id)}
          />
        ))}
      </div>
    </>
  );
}

function Toast({
  item,
  onDismiss,
  onGone,
}: {
  item: ToastItem;
  onDismiss: () => void;
  onGone: () => void;
}) {
  const meta = VARIANTS[item.variant];
  const Icon = meta.icon;
  const duration = item.variant === "error" ? SHOW_ERROR_MS : SHOW_MS;

  return (
    <div
      role={item.variant === "error" ? "alert" : "status"}
      className={cn(
        "flutter-toast pointer-events-auto relative flex origin-right items-start gap-3 overflow-hidden rounded-xl border border-border bg-card/95 py-3 pr-2.5 pl-3 text-sm text-card-foreground shadow-xl shadow-black/20 backdrop-blur-md",
        item.leaving ? "flutter-toast-out" : "flutter-toast-in",
      )}
      onAnimationEnd={(event) => {
        // Only react to this element's own exit animation, not the bar's.
        if (event.target !== event.currentTarget) return;
        if (item.leaving) onGone();
      }}
    >
      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", meta.tint)}>
        <Icon className="size-4" aria-hidden />
      </span>

      <p className="min-w-0 flex-1 self-center leading-snug break-words">
        <span className="sr-only">{meta.label}: </span>
        {item.message}
        {item.count > 1 ? (
          <span className="ml-1.5 inline-flex rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground align-[1px]">
            ×{item.count}
          </span>
        ) : null}
      </p>

      <button
        type="button"
        className="no-press shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        <X className="size-3.5" />
      </button>

      {/* Countdown bar: its animationend is the auto-dismiss timer. */}
      <span
        key={item.cycle}
        aria-hidden
        className={cn("flutter-toast-progress absolute bottom-0 left-0 h-0.5 w-full opacity-70", meta.bar)}
        style={{ animationDuration: `${duration}ms` }}
        onAnimationEnd={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
      />
    </div>
  );
}
