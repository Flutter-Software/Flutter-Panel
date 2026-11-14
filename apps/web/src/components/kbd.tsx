"use client";

/**
 * Keyboard shortcut hints.
 *
 *   <Kbd>{modKeyLabel()}K</Kbd>   // "⌘K" on Apple devices, "Ctrl K" elsewhere
 *
 * Hints are hidden on touch-only devices via the `.kbd-hint` rule in
 * globals.css, since there is no keyboard to press them on.
 */

import { useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/cn";

function detectApple() {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** "⌘" on Apple platforms, "Ctrl " elsewhere. Safe to call during SSR ("Ctrl "). */
export function modKeyLabel() {
  return detectApple() ? "⌘" : "Ctrl ";
}

/**
 * Hook form of `modKeyLabel` that avoids a hydration mismatch: the server and
 * the first client render agree on "Ctrl ", then Apple devices switch to "⌘".
 */
export function useModKeyLabel() {
  return useSyncExternalStore(
    () => () => {},
    () => modKeyLabel(),
    () => "Ctrl ",
  );
}

/** True when the event carries the platform's primary modifier (⌘ or Ctrl). */
export function isModKey(event: KeyboardEvent | { metaKey: boolean; ctrlKey: boolean }) {
  return detectApple() ? event.metaKey : event.ctrlKey;
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "kbd-hint inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[10px] leading-none font-medium whitespace-pre text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
