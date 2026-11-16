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
  // Rack controls: 3px corners, no shadows, colour change on hover only (DESIGN.md).
  return cn(
    "pressable inline-flex items-center justify-center gap-2 rounded-md font-medium disabled:pointer-events-none disabled:opacity-50",
    size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm",
    variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/85 active:bg-primary/75",
    variant === "secondary" &&
      "border border-input bg-secondary text-secondary-foreground hover:border-muted-foreground/50 hover:bg-muted",
    variant === "ghost" && "text-foreground hover:bg-muted active:bg-accent",
    variant === "danger" &&
      "bg-destructive text-destructive-foreground hover:bg-destructive/85 active:bg-destructive/75",
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
  ...rest
}: {
  href: string;
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  "aria-label"?: string;
  title?: string;
}) {
  return (
    <Link href={href} className={buttonClass({ variant, size, className })} {...rest}>
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
        "h-9 w-full rounded-md border border-input bg-well px-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/25",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The panel's single box vocabulary (DESIGN.md → Layout grammar):
 *  - `panel` (default): a raised chassis surface for a form or a block of settings.
 *  - `well`: a recessed surface, for live data such as the console or readouts.
 *  - `inset`: no box at all, just a 2px signal-cyan rule on the left. For a
 *    highlighted note or the active item in a group.
 * Lists of units are not cards: use `Rack`. Groups of numbers: use `Readout`.
 */
export function Card({
  className,
  children,
  variant = "panel",
}: {
  className?: string;
  children: ReactNode;
  variant?: "panel" | "well" | "inset";
}) {
  return (
    <div
      className={cn(
        variant === "panel" && "rounded-lg border border-border bg-card text-card-foreground",
        variant === "well" && "rounded-lg border border-border bg-well",
        variant === "inset" && "border-l-2 border-primary pl-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A rack: units of one kind (servers, nodes, users, backups…) as full-width
 * rows separated by seams, inside one frame. Never a grid of cards.
 */
export function Rack({
  className,
  children,
  label,
}: {
  className?: string;
  children: ReactNode;
  /** Accessible name for the list, e.g. "Servers". */
  label?: string;
}) {
  return (
    <div role="list" aria-label={label} className={cn("rack overflow-hidden rounded-lg border border-border bg-card", className)}>
      {children}
    </div>
  );
}

/**
 * One unit in a rack. Put a `<LedRail>` / `<Rail>` first when the unit has a status.
 * It's a flex row by default; pass `className="grid grid-cols-[…]"` for columns
 * (`cn` uses tailwind-merge, so `grid` replaces `flex`). Share the same column
 * template with a `<RackLegend>` above the rack.
 */
export function RackRow({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div role="listitem" className={cn("relative flex items-center gap-4 px-4 py-3", className)}>
      {children}
    </div>
  );
}

/**
 * Column legend above a rack, shown only where the rows are laid out as columns.
 * Pass the same grid classes the rows use, e.g.
 *   const COLS = "xl:grid xl:grid-cols-[minmax(0,1.5fr)_1fr_8rem] xl:gap-5";
 *   <RackLegend className={COLS} labels={["Name", "Node", "Status"]} />
 * Hidden from assistive tech: each `RowField` carries its own label.
 */
export function RackLegend({ labels, className }: { labels: ReactNode[]; className?: string }) {
  return (
    <div aria-hidden className={cn("hidden px-4 py-2 text-[12px] text-muted-foreground", className)}>
      {labels.map((label, index) => (
        <span key={index} className={index === 0 ? "pl-1" : undefined}>
          {label}
        </span>
      ))}
    </div>
  );
}

/**
 * A value in a rack row with its label. The label is visible only when the row
 * stacks (below `breakpoint`), where there's no column legend; on wide screens
 * it stays available to screen readers.
 */
export function RowField({
  label,
  children,
  breakpoint = "xl",
  className,
}: {
  label: string;
  children: ReactNode;
  breakpoint?: "md" | "lg" | "xl";
  className?: string;
}) {
  // Full class names so Tailwind can see them (no string-built class names).
  const wide = {
    md: { pad: "md:pl-0", label: "md:sr-only" },
    lg: { pad: "lg:pl-0", label: "lg:sr-only" },
    xl: { pad: "xl:pl-0", label: "xl:sr-only" },
  }[breakpoint];
  return (
    <div className={cn("min-w-0 pl-1 text-sm", wide.pad, className)}>
      <p className={cn("text-[12px] text-muted-foreground", wide.label)}>{label}</p>
      <div className="min-w-0 truncate">{children}</div>
    </div>
  );
}

/**
 * Readout strip: a few live numbers about one thing, in one recessed well
 * divided by vertical seams (an instrument cluster), instead of a card per number.
 * Stacks into rows on narrow screens.
 */
export function Readout({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "grid overflow-hidden rounded-lg border border-border bg-well [grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr))]",
        "[&>*]:border-border [&>*]:border-b [&>*]:border-r",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** One cell of a `Readout`: a label, a big tabular value, and an optional detail line or meter. */
export function ReadoutCell({
  label,
  value,
  detail,
  meter,
  meterClassName,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  /** 0–100; draws a thin meter along the bottom of the cell. */
  meter?: number;
  meterClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative -mb-px -mr-px min-w-0 px-4 pb-3.5 pt-3", className)}>
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p data-numeric className="mt-0.5 truncate font-display text-[25px] font-semibold leading-tight">
        {value}
      </p>
      {detail ? <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{detail}</p> : null}
      {typeof meter === "number" ? (
        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-border" aria-hidden>
          <span
            className={cn("block h-full bg-primary", meterClassName)}
            style={{ width: `${Math.max(0, Math.min(100, meter))}%` }}
          />
        </span>
      ) : null}
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
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-primary/15 px-1.5 text-[11px] font-semibold tabular-nums text-primary",
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
        "min-h-[88px] w-full resize-y rounded-md border border-input bg-well px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/25",
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
  action,
}: {
  title: string;
  description?: string;
  /** The next step, usually one Button or ButtonLink ("Create server"). An empty screen is an invitation to act. */
  action?: ReactNode;
}) {
  return (
    // An empty rack: a dashed frame where the rows would be, left-aligned like the content it replaces.
    <div className="rounded-lg border border-dashed border-input px-5 py-10">
      <p className="font-display text-[20px] font-semibold">{title}</p>
      {description ? <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap gap-2">{action}</div> : null}
    </div>
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
          "no-press absolute inset-0 bg-background/75",
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
          "flutter-sheet relative flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-xl border border-b-0 border-border bg-card pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-float)] sm:max-h-[min(92vh,52rem)] sm:rounded-xl sm:border-b sm:pb-0",
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
            <h2 id="flutter-modal-title" className="text-[20px] font-semibold">
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
