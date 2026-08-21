import { cn } from "@/lib/cn";

export const LOGO_SRC = "/flutter-logo.png";

export function BrandMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={LOGO_SRC}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", className)}
      style={{ width: size, height: size }}
      aria-hidden
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
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <BrandMark size={size} />
      <span className="text-[15px] font-semibold tracking-tight">Flutter</span>
    </span>
  );
}

export function AuthBrand({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <BrandMark size={72} />
      <p className="text-sm font-medium tracking-[0.28em] text-muted-foreground">FLUTTER</p>
    </div>
  );
}
