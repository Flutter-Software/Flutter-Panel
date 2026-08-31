import { Infinity as InfinityIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMb } from "@/lib/types";

export function UnlimitedIcon({ className }: { className?: string }) {
  return (
    <InfinityIcon
      className={cn("inline size-[1.1em] shrink-0", className)}
      strokeWidth={2.25}
      aria-label="unlimited"
    />
  );
}

export function LimitMb({ value }: { value: number }) {
  return value > 0 ? formatMb(value) : <UnlimitedIcon />;
}

export function CpuLimit({ value }: { value: number }) {
  return value > 0 ? `${value}%` : <UnlimitedIcon />;
}

export function UnlimitedStat({ used }: { used: string }) {
  return (
    <span className="inline-flex items-center gap-[0.35em]">
      {used}
      <span className="font-normal text-muted-foreground">/</span>
      <UnlimitedIcon />
    </span>
  );
}
