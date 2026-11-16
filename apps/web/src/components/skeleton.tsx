import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A placeholder bar. Pulses gently while loading; holds still for people who
 * asked for reduced motion (OS setting, or "Smooth transitions" off, which sets
 * html[data-reduce-motion="off"]).
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-sm bg-muted motion-reduce:animate-none [html[data-reduce-motion=off]_&]:animate-none",
        className,
      )}
    />
  );
}

export function SkeletonRoot({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {children}
    </div>
  );
}

export function skeletonKeys(count: number) {
  return Array.from({ length: count }, (_, index) => index);
}

/** Placeholder for a `Card` panel (a form or block of settings). */
export function SkeletonCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-card text-card-foreground", className)}>
      {children}
    </div>
  );
}

/** Placeholder for a recessed `Card variant="well"` (console, readouts, graphs). */
export function SkeletonWell({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("rounded-lg border border-border bg-well", className)}>{children}</div>;
}

/** Placeholder for a `Rack`: one frame, rows separated by seams. Put rack-row skeletons inside. */
export function SkeletonRack({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div aria-hidden className={cn("rack overflow-hidden rounded-lg border border-border bg-card", className)}>
      {children}
    </div>
  );
}

/**
 * The LED rail slot on a rack-row skeleton. Seam-coloured, not a status colour,
 * because the status isn't known yet. The parent must be `relative`.
 */
export function SkeletonRail() {
  return <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-border" />;
}

/**
 * Column legend above a rack, as real text (it doesn't change once data loads,
 * so it shouldn't pulse). `columns` is the same grid class the live rows use.
 */
export function SkeletonLegend({
  columns,
  labels,
  className,
}: {
  columns: string;
  labels: string[];
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("hidden px-4 py-2 text-[12px] text-muted-foreground", columns, className)}>
      {labels.map((label, index) => (
        <span key={`${label}-${index}`} className={index === 0 ? "pl-1" : undefined}>
          {label}
        </span>
      ))}
    </div>
  );
}

/** A thin usage-meter placeholder, matching the 3px meters in racks and readouts. */
export function SkeletonMeter({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block h-[3px] bg-border", className)} />;
}
