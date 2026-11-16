"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useBranding } from "@/components/branding-provider";
import { AuthFooter } from "@/components/auth-footer";
import { Rack, RackRow } from "@/components/ui";
import { LedRail, StatusPill } from "@/components/status";
import type { ServerStatus } from "@/lib/types";

export function BrandMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const { logoSrc, siteName } = useBranding();
  return (
    <img
      src={logoSrc}
      alt={siteName}
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}

/** Logo plus site name, set in the condensed display face like a chassis legend. */
export function Wordmark({
  className,
  size = 28,
}: {
  className?: string;
  size?: number;
}) {
  const { siteName } = useBranding();
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <BrandMark size={size} />
      <span className="font-display text-[17px] font-semibold leading-none">{siteName}</span>
    </span>
  );
}

/**
 * The brand as it appears above the form on signed-out pages. Left-aligned with
 * the form it introduces; on wide screens the side panel carries it instead.
 */
export function AuthBrand({ className }: { className?: string }) {
  const { siteName } = useBranding();
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <BrandMark size={32} />
      <p className="font-display text-[20px] font-semibold leading-none">{siteName}</p>
    </div>
  );
}

/** Dummy units for the side panel's rack motif. Real UI parts, fake data. */
const MOTIF_ROWS: { name: string; game: string; status: ServerStatus; usage: string }[] = [
  { name: "Survival", game: "Paper 1.21", status: "running", usage: "45%" },
  { name: "Creative", game: "Paper 1.21", status: "starting", usage: "" },
  { name: "Modded", game: "Forge 1.20", status: "offline", usage: "" },
];

/**
 * A small rack built from the same parts the panel uses (Rack, LED rail,
 * status LED). It's decoration, so it's hidden from assistive tech. The
 * "starting" LED pulses; reduced-motion users get a steady one (globals.css).
 */
function RackMotif() {
  return (
    <div aria-hidden className="pointer-events-none select-none">
      <Rack className="max-w-[26rem]">
        {MOTIF_ROWS.map((row) => (
          <RackRow key={row.name} className="py-3 pl-5">
            <LedRail status={row.status} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[17px] font-semibold leading-tight">{row.name}</p>
              <p className="truncate text-[13px] text-muted-foreground">{row.game}</p>
            </div>
            <span className="w-10 text-right text-[13px] tabular-nums text-muted-foreground">
              {row.usage || "–"}
            </span>
            <StatusPill status={row.status} className="w-[5.5rem]" />
          </RackRow>
        ))}
      </Rack>
    </div>
  );
}

/**
 * Layout for every signed-out page (sign in, register, verify, invite).
 *
 *  wide:   | graphite rail: brand, rack motif, version |  form on the page background |
 *  narrow: brand, then the form, then the version.
 *
 * Deliberately not a centred card on a gradient: the side panel shows what the
 * product is (a rack of servers with status LEDs) using the panel's own parts.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const { siteName } = useBranding();
  return (
    <div className="grid min-h-full bg-background lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="hidden flex-col justify-between gap-12 border-r border-border bg-sidebar px-12 py-10 lg:flex xl:px-16">
        <div className="flex items-center gap-3">
          <BrandMark size={36} />
          <p className="font-display text-[25px] font-semibold leading-none">{siteName}</p>
        </div>

        <div className="space-y-5">
          <RackMotif />
          <p className="max-w-[26rem] text-sm text-muted-foreground">
            Start, stop and watch your game servers from one place. Every unit shows its state on the left edge:
            green is running, amber is changing, grey is off.
          </p>
        </div>

        <AuthFooter />
      </aside>

      <main className="flex min-w-0 flex-col px-4 py-10 sm:px-10">
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center">
          <AuthBrand className="mb-10 lg:hidden" />
          {children}
        </div>
        <AuthFooter className="mx-auto mt-10 w-full max-w-[380px] lg:hidden" />
      </main>
    </div>
  );
}

/**
 * A form error on the signed-out pages: a 2px status-error rule on the left
 * (the inset treatment from DESIGN.md, in the error colour) instead of a tinted box.
 * Announced to screen readers as soon as it appears.
 */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="border-l-2 border-status-error pl-3 text-sm text-status-error">
      {children}
    </p>
  );
}

/** Page title and one plain sentence under it, for the signed-out forms. */
export function AuthHeading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div>
      <h1 className="text-[25px] font-semibold">{title}</h1>
      {children ? <p className="mt-1.5 text-sm text-muted-foreground">{children}</p> : null}
    </div>
  );
}
