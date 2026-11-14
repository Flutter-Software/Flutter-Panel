"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
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
  ref,
  ...props
}: ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <button ref={ref} className={buttonClass({ variant, size, className })} {...props} />;
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
          {required ? <span className="ml-0.5 text-muted-foreground">*</span> : null}
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

/** Downward drag (px) past which a released sheet closes. */
const SHEET_DISMISS_PX = 120;
/** A quick downward flick (px/ms) closes it even if it hasn't moved far. */
const SHEET_FLICK_SPEED = 0.5;

/**
 * Swipe-down-to-dismiss for the mobile bottom sheet. Only touch and pen drags
 * count (mouse users have the close button and Esc), and only on small screens
 * where the modal is a sheet. Upward drags are resisted so it can't be pulled
 * off its edge. Releasing short of the threshold springs back.
 */
function useSheetDrag(open: boolean, onClose: () => void) {
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ y: number; t: number; id: number } | null>(null);

  // A sheet dismissed by dragging keeps its offset for the exit animation;
  // clear it when the modal opens again.
  useEffect(() => {
    if (open) setDy(0);
  }, [open]);

  function finish(event: ReactPointerEvent<HTMLElement>, cancelled: boolean) {
    const origin = start.current;
    if (!origin || origin.id !== event.pointerId) return;
    start.current = null;
    setDragging(false);
    const delta = event.clientY - origin.y;
    const speed = delta / Math.max(1, event.timeStamp - origin.t);
    if (!cancelled && (delta > SHEET_DISMISS_PX || (delta > 24 && speed > SHEET_FLICK_SPEED))) {
      // Keep the offset: the exit animation continues from it (--sheet-y).
      onClose();
      return;
    }
    setDy(0);
  }

  return {
    style: dy
      ? ({
          transform: `translateY(${dy}px)`,
          "--sheet-y": `${dy}px`,
          transition: dragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        } as CSSProperties)
      : undefined,
    handlers: {
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        if (event.pointerType === "mouse" || !window.matchMedia("(max-width: 639px)").matches) return;
        // Let buttons in the header (close) keep working.
        if ((event.target as HTMLElement).closest("button, a, input")) return;
        start.current = { y: event.clientY, t: event.timeStamp, id: event.pointerId };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event: ReactPointerEvent<HTMLElement>) {
        const origin = start.current;
        if (!origin || origin.id !== event.pointerId) return;
        const delta = event.clientY - origin.y;
        setDragging(true);
        // Rubber-band upward drags to a fraction of the finger's travel.
        setDy(delta > 0 ? delta : delta / 6);
      },
      onPointerUp: (event: ReactPointerEvent<HTMLElement>) => finish(event, false),
      onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => finish(event, true),
    },
  };
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
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const frame = useRef({ title, description, children, footer });
  if (open) frame.current = { title, description, children, footer };
  if (open && !shown) {
    setShown(true);
    setLeaving(false);
  }

  useEffect(() => {
    if (open) {
      setShown(true);
      setLeaving(false);
      return;
    }
    if (!shown) return;
    setLeaving(true);
    const handle = window.setTimeout(() => {
      setShown(false);
      setLeaving(false);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [open, shown]);

  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !leaving) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [shown, leaving, onClose]);

  const sheet = useSheetDrag(open, onClose);

  if (!shown) return null;

  const view = frame.current;

  return (
    <div
      className={cn(
        // Below `sm` the modal docks to the bottom as a sheet; above, it's centred.
        "fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6",
        leaving && "pointer-events-none",
      )}
    >
      <button
        type="button"
        className={cn(
          "no-press absolute inset-0 bg-background/80 backdrop-blur-sm",
          leaving ? "flutter-modal-backdrop-out" : "flutter-modal-backdrop-in",
        )}
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="flutter-modal-title"
        className={cn(
          "flutter-sheet relative flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-xl border border-b-0 border-border bg-card pb-[env(safe-area-inset-bottom)] shadow-2xl sm:max-h-[min(92vh,52rem)] sm:rounded-xl sm:border-b sm:pb-0",
          leaving ? "flutter-modal-out" : "flutter-modal-in",
          className,
        )}
        style={sheet.style}
      >
        {/* Grab handle + header are the drag area for swipe-down-to-dismiss on phones. */}
        <div className="flex shrink-0 justify-center pt-2 sm:hidden" {...sheet.handlers} style={{ touchAction: "none" }}>
          <span className="h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
        </div>
        <div
          className="flex shrink-0 touch-none items-start gap-3 border-b border-border px-4 py-3 sm:touch-auto"
          {...sheet.handlers}
        >
          <div className="min-w-0 flex-1">
            <h2 id="flutter-modal-title" className="text-base font-semibold">
              {view.title}
            </h2>
            {view.description ? (
              <p className="mt-0.5 text-sm text-muted-foreground">{view.description}</p>
            ) : null}
          </div>
          <Button type="button" size="sm" variant="ghost" className="hit-slop size-8 px-0" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{view.children}</div>
        {view.footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
            {view.footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
