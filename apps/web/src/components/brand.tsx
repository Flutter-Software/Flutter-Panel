"use client";

import { cn } from "@/lib/cn";
import { DEFAULT_LOGO_SRC, useBranding } from "@/components/branding-provider";

export const LOGO_SRC = DEFAULT_LOGO_SRC;

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
      <span className="text-[15px] font-semibold tracking-tight">{siteName}</span>
    </span>
  );
}

export function AuthBrand({ className }: { className?: string }) {
  const { siteName } = useBranding();
  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <BrandMark size={72} />
      <p className="text-sm font-medium tracking-tight text-muted-foreground">{siteName}</p>
    </div>
  );
}
