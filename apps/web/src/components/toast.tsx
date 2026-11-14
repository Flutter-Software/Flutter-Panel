"use client";

/**
 * Panel-wide toasts.
 *
 *   toast("Could not send command");          // error (default, for catch blocks)
 *   toast("Branding saved.", "success");
 *   toast("Daemon is restarting", "info");
 *   toast("Disk is almost full", "warning");
 *
 *   // With an action button (see lib/undoable.ts for the undo pattern):
 *   toast("Deleted server.properties", "info", {
 *     action: { label: "Undo", onClick: restore, undo: true },
 *     onSettle: commitDelete,   // runs once, unless the action was clicked
 *   });
 *
 * Design notes:
 * - Each toast is a card with a tinted status icon, the message, an optional
 *   action button, a close button, and a thin countdown bar along the bottom.
 * - The countdown is a CSS animation; its `animationend` dismisses the toast.
 *   Hovering (or focusing) the stack pauses every bar via
 *   `animation-play-state`, so a toast never vanishes while being read. Because
 *   an undo toast commits when its bar runs out, hovering also holds the commit.
 * - `onSettle` fires exactly once when a toast leaves for any reason other than
 *   its action: countdown, close button, swipe, or being pushed out of the
 *   stack. Clicking the action skips it. That makes "Undo" safe by design.
 * - Ctrl/Cmd+Z (outside text fields) triggers the newest toast's undo action.
 * - Toasts can be swiped sideways to dismiss on touch screens (or dragged with
 *   a mouse); a short drag springs back.
 * - Repeating the same plain message while it is still visible bumps a "×N"
 *   counter and restarts its countdown instead of stacking duplicates
 *   (e.g. a power button mashed while the daemon is down). Toasts with an
 *   action never merge, since each one guards its own change.
 * - At most MAX_VISIBLE toasts are shown; older ones are dropped (and settled).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { Kbd, modKeyLabel } from "@/components/kbd";
import { cn } from "@/lib/cn";

export type ToastVariant = "error" | "success" | "info" | "warning";

export type ToastAction = {
  label: string;
  onClick: () => void;
  /** Marks this as an undo action: it gets a Ctrl/Cmd+Z hint and shortcut. */
  undo?: boolean;
};

export type ToastOptions = {
  action?: ToastAction;
  /** Countdown length in ms. Defaults depend on the variant. */
  duration?: number;
  /** Runs once when the toast leaves for any reason except its action. */
  onSettle?: () => void;
};

type ToastItem = {
  id: number;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
  duration: number;
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
/** Horizontal drag (px) past which a released toast is dismissed. */
const SWIPE_DISMISS_PX = 80;
/** A quick flick (px/ms) dismisses even if it hasn't travelled far. */
const SWIPE_FLICK_SPEED = 0.6;

let pushToast: (message: string, variant: ToastVariant, options: ToastOptions) => number = () => 0;
let dismissById: (id: number) => void = () => {};
let nextId = 1;

/**
 * Settle callbacks live outside React state so they can never run twice, even
 * under StrictMode's double-invoked updaters. `settle` deletes before calling.
 */
const settlers = new Map<number, () => void>();

function settle(id: number) {
  const run = settlers.get(id);
  if (!run) return;
  settlers.delete(id);
  try {
    run();
  } catch (err) {
    console.error("toast onSettle failed", err);
  }
}

/** Shows a toast and returns its id (for `dismissToast`). */
export function toast(message: string, variant: ToastVariant = "error", options: ToastOptions = {}) {
  return pushToast(message, variant, options);
}

/** Dismisses a toast early. Its `onSettle` still runs. */
export function dismissToast(id: number) {
  dismissById(id);
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

/** True when a keystroke belongs to a text field or code editor, not the page. */
function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest(".monaco-editor")) return true;
  return target.matches("input, textarea, select");
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  // Mirror of `items` so push() can work out which toasts it drops (and settle
  // them) outside of a state updater.
  const itemsRef = useRef<ToastItem[]>([]);

  const commit = useCallback((next: ToastItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const remove = useCallback(
    (id: number) => commit(itemsRef.current.filter((item) => item.id !== id)),
    [commit],
  );

  /** Starts the exit animation. `skipSettle` is used only by the action button. */
  const dismiss = useCallback(
    (id: number, skipSettle = false) => {
      if (skipSettle) settlers.delete(id);
      else settle(id);
      commit(
        itemsRef.current.map((item) => (item.id === id && !item.leaving ? { ...item, leaving: true } : item)),
      );
    },
    [commit],
  );

  const push = useCallback(
    (message: string, variant: ToastVariant, options: ToastOptions) => {
      const current = itemsRef.current;
      const duration = options.duration ?? (variant === "error" ? SHOW_ERROR_MS : SHOW_MS);

      if (!options.action) {
        const repeat = current.find(
          (item) => !item.leaving && !item.action && item.message === message && item.variant === variant,
        );
        if (repeat) {
          commit(
            current.map((item) =>
              item === repeat ? { ...item, count: item.count + 1, cycle: item.cycle + 1 } : item,
            ),
          );
          return repeat.id;
        }
      }

      const id = nextId;
      nextId += 1;
      if (options.onSettle) settlers.set(id, options.onSettle);

      const live = current.filter((item) => !item.leaving);
      const kept = live.slice(-(MAX_VISIBLE - 1));
      for (const dropped of live.slice(0, live.length - kept.length)) settle(dropped.id);

      commit([
        ...kept,
        { id, message, variant, action: options.action, duration, count: 1, cycle: 0 },
      ]);
      return id;
    },
    [commit],
  );

  useEffect(() => {
    pushToast = push;
    dismissById = (id) => dismiss(id);
    return () => {
      pushToast = () => 0;
      dismissById = () => {};
    };
  }, [push, dismiss]);

  // Ctrl/Cmd+Z undoes the newest undoable toast, unless focus is in a text
  // field (where the user expects the field's own undo).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || event.shiftKey || event.altKey) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (isEditableTarget(event.target)) return;
      const latest = [...itemsRef.current].reverse().find((item) => !item.leaving && item.action?.undo);
      if (!latest?.action) return;
      event.preventDefault();
      latest.action.onClick();
      dismiss(latest.id, true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  return (
    <>
      {children}
      <div
        // Container stays mounted so screen readers keep the live region registered.
        aria-live="polite"
        className="flutter-toast-stack pointer-events-none fixed top-[calc(5rem+env(safe-area-inset-top))] right-[calc(1rem+env(safe-area-inset-right))] z-50 flex w-[min(100%-2rem,24rem)] flex-col gap-2"
      >
        {items.map((item) => (
          <Toast
            key={item.id}
            item={item}
            onDismiss={() => dismiss(item.id)}
            onAction={() => {
              item.action?.onClick();
              dismiss(item.id, true);
            }}
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
  onAction,
  onGone,
}: {
  item: ToastItem;
  onDismiss: () => void;
  onAction: () => void;
  onGone: () => void;
}) {
  const meta = VARIANTS[item.variant];
  const Icon = meta.icon;
  const swipe = useSwipeToDismiss(onDismiss);

  return (
    <div
      role={item.variant === "error" ? "alert" : "status"}
      className={cn(
        "flutter-toast pointer-events-auto relative flex origin-right touch-pan-y items-start gap-3 overflow-hidden rounded-xl border border-border bg-card/95 py-3 pr-2.5 pl-3 text-sm text-card-foreground shadow-xl shadow-black/20 backdrop-blur-md select-none",
        item.leaving ? "flutter-toast-out" : "flutter-toast-in",
      )}
      style={swipe.style}
      {...swipe.handlers}
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

      {item.action ? (
        <button
          type="button"
          className="no-press hit-slop shrink-0 self-center rounded-md px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
          onClick={onAction}
          // Keep the click from being read as the start of a swipe.
          onPointerDown={(event) => event.stopPropagation()}
        >
          {item.action.label}
          {item.action.undo ? (
            <Kbd className="ml-1.5 hidden sm:inline-flex">{modKeyLabel()}Z</Kbd>
          ) : null}
        </button>
      ) : null}

      <button
        type="button"
        className="no-press hit-slop shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
        aria-label="Dismiss notification"
        onClick={onDismiss}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <X className="size-3.5" />
      </button>

      {/* Countdown bar: its animationend is the auto-dismiss timer. */}
      <span
        key={item.cycle}
        aria-hidden
        className={cn("flutter-toast-progress absolute bottom-0 left-0 h-0.5 w-full opacity-70", meta.bar)}
        style={{ animationDuration: `${item.duration}ms` }}
        onAnimationEnd={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
      />
    </div>
  );
}

/**
 * Horizontal swipe-to-dismiss. The toast follows the pointer; on release it
 * either flies out (far enough, or flicked fast enough) or springs back.
 * Vertical scrolling is left to the browser via `touch-action: pan-y`.
 */
function useSwipeToDismiss(onDismiss: () => void) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; t: number; id: number } | null>(null);

  function end(event: ReactPointerEvent<HTMLElement>, cancelled: boolean) {
    const origin = start.current;
    if (!origin || origin.id !== event.pointerId) return;
    start.current = null;
    setDragging(false);
    const delta = event.clientX - origin.x;
    const speed = Math.abs(delta) / Math.max(1, event.timeStamp - origin.t);
    if (!cancelled && (Math.abs(delta) > SWIPE_DISMISS_PX || speed > SWIPE_FLICK_SPEED)) {
      // Leave it where the finger let go; the exit animation takes over.
      onDismiss();
      return;
    }
    setDx(0);
  }

  const opacity = Math.max(0.2, 1 - Math.abs(dx) / 240);
  return {
    style: dx
      ? ({
          transform: `translateX(${dx}px)`,
          opacity,
          // The exit animation starts from here (see flutter-toast-out).
          "--swipe-x": `${dx}px`,
          "--swipe-opacity": opacity,
          // Springs back with a transition, but tracks the finger 1:1.
          transition: dragging ? "none" : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease",
        } as CSSProperties)
      : undefined,
    handlers: {
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        if (event.button !== 0) return;
        start.current = { x: event.clientX, t: event.timeStamp, id: event.pointerId };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event: ReactPointerEvent<HTMLElement>) {
        const origin = start.current;
        if (!origin || origin.id !== event.pointerId) return;
        const delta = event.clientX - origin.x;
        if (!dragging && Math.abs(delta) < 4) return;
        setDragging(true);
        setDx(delta);
      },
      onPointerUp: (event: ReactPointerEvent<HTMLElement>) => end(event, false),
      onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => end(event, true),
    },
  };
}
